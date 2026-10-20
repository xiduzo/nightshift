import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixturePath } from "@nightshift/agents/testing";
import type { AppRouterClient } from "@nightshift/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import {
	type Daemon,
	pair,
	startDaemon,
	stopDaemon,
	waitFor,
} from "./test-daemons";

/**
 * Offers between two daemons and two Persons. A is the Host; its Person
 * owns B, a paired Device with the only fake Claude Code, and makes the
 * Space "Platform", where a colleague joins by invitation. The colleague
 * signs in to A from "another computer" and starts runs placed on B. B
 * offers its profile `coder` to Platform with caps. Without the Offer, or
 * naming anything else, the run is refused at start; through it, the
 * steps run on B with B's profile under the caps, logged with who started
 * the run and where it ran; withdrawing on B stops a running step.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), "nightshift-offers-")));
const REMOTE = "https://example.com/acme/shared.git";
const FAKE_CLAUDE = fixturePath("fake-claude.ts");
/** Each fake Claude Code session on B writes its pid here, and its arguments. */
const PIDS = join(root, "claude-pids");
const ARGS = join(root, "claude-args");
/** How long the fake session on B takes, read when it starts. */
const SLEEP_MS = join(root, "claude-sleep-ms");
const COLLEAGUE = "colleague@example.com";

let a: Daemon;
let b: Daemon;
let bId: string;
let bName: string;
let colleague: AppRouterClient;
let colleagueId: string;
let ownerOnA: string;
let spaceId: string;
let projectId: string;
let folderOnB: string;

function git(cwd: string, ...args: string[]) {
	const child = Bun.spawnSync(
		[
			"git",
			"-c",
			"user.name=Night Shift Test",
			"-c",
			"user.email=test@nightshift.invalid",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{ cwd, stdout: "pipe", stderr: "pipe" },
	);
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
	return child.stdout.toString().trim();
}

function repo(name: string): string {
	const path = join(root, name);
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, "README.md"), `# ${name}\n`);
	git(path, "init", "-q", "-b", "main");
	git(path, "remote", "add", "origin", REMOTE);
	git(path, "add", "README.md");
	git(path, "commit", "-q", "-m", "initial");
	return path;
}

/** A flow in B's Clone with one Agent node. */
function flowOnB(name: string, agent: Record<string, unknown>) {
	const dir = join(folderOnB, ".nightshift", "flows");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${name}.json`),
		JSON.stringify({
			version: 5,
			inputs: [],
			outputs: [],
			start: "work",
			nodes: [
				{
					id: "work",
					type: "agent",
					position: { x: 0, y: 0 },
					prompt: "Do the work.",
					...agent,
				},
			],
			edges: [],
		}),
	);
}

function lines(path: string): string[] {
	try {
		return readFileSync(path, "utf8").split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** The payloads of A's events of a type. */
function eventsOnA(type: string): Record<string, unknown>[] {
	const db = new Database(join(a.dataDir, "nightshift.db"), { readonly: true });
	try {
		return db
			.query<{ payload: string }, [string]>(
				"select payload from event where type = ? order by seq",
			)
			.all(type)
			.map((row) => JSON.parse(row.payload));
	} finally {
		db.close();
	}
}

async function runOf(runId: string) {
	return (await colleague.runs.list()).find((r) => r.id === runId);
}

/** The colleague signs up from the invitation's link, on A, from another computer. */
async function signUpColleague(invitationId: string): Promise<AppRouterClient> {
	const elsewhere = { "x-forwarded-for": "10.0.0.2" };
	const response = await fetch(`${a.url}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "content-type": "application/json", ...elsewhere },
		body: JSON.stringify({
			name: "Colleague",
			email: COLLEAGUE,
			password: "a-long-password",
			invitationId,
		}),
	});
	if (!response.ok) throw new Error(await response.text());
	const cookie = response.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
	return createORPCClient(
		new RPCLink({ url: `${a.url}/rpc`, headers: { cookie, ...elsewhere } }),
	);
}

beforeAll(async () => {
	const claude = join(root, "claude");
	writeFileSync(
		claude,
		`#!/bin/sh\necho $$ >> '${PIDS}'\necho "$@" >> '${ARGS}'\nexport FAKE_CLAUDE_SLEEP_MS=$(cat '${SLEEP_MS}' 2>/dev/null || echo 0)\nexec '${process.execPath}' '${FAKE_CLAUDE}' "$@"\n`,
	);
	chmodSync(claude, 0o755);
	[a, b] = await Promise.all([
		startDaemon(root, "a", { NIGHTSHIFT_HOST: "on" }),
		startDaemon(root, "b", { NIGHTSHIFT_CLAUDE_BIN: claude }),
	]);
	bId = await pair(a, b);
	await waitFor(
		async () => (await b.client.devices.list()).thisComputer?.hosts ?? [],
		(hosts) => hosts[0]?.status === "online",
	);
	bName = (await a.client.devices.list()).devices.find((d) => d.id === bId)
		?.name as string;

	// A's Person makes "Platform" and invites the colleague.
	spaceId = (await a.client.spaces.create({ name: "Platform" })).id;
	const invitation = await a.client.members.invite({
		email: COLLEAGUE,
		role: "member",
	});
	colleague = await signUpColleague(invitation.id);
	await colleague.invitations.accept({ invitationId: invitation.id });
	const members = await a.client.members.list();
	colleagueId = members.members.find((m) => m.email === COLLEAGUE)
		?.personId as string;
	ownerOnA = members.you;

	// The project is in Platform; B has a Clone of it.
	projectId = (await a.client.projects.add({ repoPath: repo("on-a") })).id;
	await waitFor(
		async () => (await b.client.spaces.list()).spaces,
		(spaces) => spaces.some((s) => s.id === spaceId),
	);
	await b.client.spaces.switch({ spaceId });
	folderOnB = repo("on-b");
	await waitFor(
		() => b.client.projects.add({ repoPath: folderOnB }).catch(() => null),
		(project) => project?.id === projectId,
	);
	// B's profile: its owner set it wide open; the Offer caps it.
	await b.client.profiles.save({
		name: "coder",
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "bypassPermissions",
		clis: [],
		connections: [],
	});
	flowOnB("offered", { profile: "coder" });
}, 180_000);

afterAll(async () => {
	await Promise.all([stopDaemon(a), stopDaemon(b)]);
	rmSync(root, { recursive: true, force: true });
});

describe("a colleague's run on another Person's Device", () => {
	test("without an Offer it is refused at start, naming the Device", async () => {
		await expect(
			colleague.runs.start({ projectId, flowName: "offered", deviceId: bId }),
		).rejects.toThrow(
			`${bName} is not your device. It offers nothing to this Space.`,
		);
	}, 30_000);

	test("B's owner offers `coder` to Platform: the Space lists it, and nothing else of B", async () => {
		const { spaces } = await b.client.offers.list();
		expect(spaces.map((s) => s.id)).toContain(spaceId);
		await b.client.offers.make({
			spaceId,
			profile: "coder",
			permissionCap: "acceptEdits",
			sessionCap: 1,
		});
		const placements = await waitFor(
			() => colleague.runs.placements({ projectId }),
			(list) => list.some((p) => p.deviceId === bId),
		);
		expect(placements.find((p) => p.deviceId === bId)).toEqual({
			deviceId: bId,
			name: bName,
			thisDevice: false,
			offers: ["coder"],
		});
		// What the colleague sees of B: name, online, Clones, offered profiles.
		const devices = await colleague.devices.space();
		const seen = devices.find((d) => d.id === bId);
		expect(seen).toEqual({
			id: bId,
			name: bName,
			online: true,
			thisDevice: false,
			clones: [{ projectId, projectName: "on-a" }],
			offers: [
				{ profile: "coder", permissionCap: "acceptEdits", sessionCap: 1 },
			],
		});
		expect(JSON.stringify(devices)).not.toContain("sonnet");
		expect(JSON.stringify(devices)).not.toContain("bypassPermissions");
		// B's own view: listed in the Space.
		const [mine] = await waitFor(
			async () => (await b.client.offers.list()).offers,
			(offers) => offers[0]?.listed === true,
		);
		expect(mine).toMatchObject({ spaceName: "Platform", profile: "coder" });
		expect(eventsOnA("OfferMade")).toEqual([
			{
				deviceId: bId,
				deviceName: bName,
				profile: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				by: ownerOnA,
			},
		]);
	}, 60_000);

	test("naming another profile, or a wider permission mode, is refused at start", async () => {
		flowOnB("other", { profile: "claude" });
		await expect(
			colleague.runs.start({ projectId, flowName: "other", deviceId: bId }),
		).rejects.toThrow(`${bName} offers "coder" to this Space, not "claude".`);
		flowOnB("wide", { profile: "coder", permissionMode: "bypassPermissions" });
		await expect(
			colleague.runs.start({ projectId, flowName: "wide", deviceId: bId }),
		).rejects.toThrow("with acceptEdits at most");
	}, 30_000);

	test("through the Offer it runs on B under the caps, in the colleague's name", async () => {
		writeFileSync(SLEEP_MS, "0");
		const started = await colleague.runs.start({
			projectId,
			flowName: "offered",
			deviceId: bId,
		});
		expect(started.device).toMatchObject({ id: bId, thisDevice: false });
		await waitFor(
			() => runOf(started.id),
			(r) => r?.status === "finished",
			60_000,
		);
		const detail = await colleague.runs.get({ runId: started.id });
		expect(detail.startedBy).toEqual({ id: colleagueId, name: "Colleague" });
		expect(
			detail.steps.map((s) => [s.nodeId, s.outcome, s.device?.id]),
		).toEqual([["work", "pass", bId]]);
		// B ran its own profile, its mode clamped to the cap.
		const args = lines(ARGS).at(-1) ?? "";
		expect(args).toContain("acceptEdits");
		expect(args).not.toContain("bypassPermissions");
		// The run's copy holds no setting of B's profile.
		expect(JSON.stringify(detail)).not.toContain("sonnet");
		// Where B keeps the run's worktree stays with B's owner.
		expect(started.worktreePath).toBe("");
		expect(detail.worktreePath).toBe("");
		expect(detail.takeOverCommand).toBeNull();
		const onA = await a.client.runs.get({ runId: started.id });
		expect(onA.worktreePath.startsWith(join(root, "on-b.nightshift"))).toBe(
			true,
		);
		// The worktree on B commits in the colleague's name.
		expect(
			git(onA.worktreePath, "config", "--worktree", "--get", "user.email"),
		).toBe(COLLEAGUE);
		const runStarted = eventsOnA("RunStarted").at(-1);
		expect(runStarted?.startedBy).toBe(colleagueId);
		expect(eventsOnA("StepStarted").at(-1)?.deviceId).toBe(bId);
		// B's Devices page: "Runs for Platform".
		const [mine] = await waitFor(
			async () => (await b.client.offers.list()).offers,
			(offers) => offers[0]?.runs.some((r) => r.id === started.id) === true,
		);
		expect(mine?.runs[0]).toMatchObject({
			id: started.id,
			startedBy: "Colleague",
		});
	}, 90_000);

	test("the session cap holds: a second session waits for the first", async () => {
		writeFileSync(SLEEP_MS, "1500");
		const before = lines(PIDS).length;
		const runs = await Promise.all([
			colleague.runs.start({ projectId, flowName: "offered", deviceId: bId }),
			colleague.runs.start({ projectId, flowName: "offered", deviceId: bId }),
		]);
		let most = 0;
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			const live = lines(PIDS).slice(before).map(Number).filter(alive).length;
			most = Math.max(most, live);
			const statuses = await Promise.all(runs.map((r) => runOf(r.id)));
			if (statuses.every((r) => r?.status === "finished")) break;
			await Bun.sleep(50);
		}
		expect(lines(PIDS).length - before).toBe(2);
		expect(most).toBe(1);
		writeFileSync(SLEEP_MS, "0");
	}, 90_000);

	test("withdrawing on B ends the running step as stopped, and the Offer", async () => {
		writeFileSync(SLEEP_MS, "60000");
		const before = lines(PIDS).length;
		const started = await colleague.runs.start({
			projectId,
			flowName: "offered",
			deviceId: bId,
		});
		await waitFor(
			() => lines(PIDS),
			(list) => list.length > before,
			30_000,
		);
		const pid = Number(lines(PIDS).at(-1));
		expect(alive(pid)).toBe(true);

		await b.client.offers.withdraw({ spaceId, profile: "coder" });
		await waitFor(
			() => runOf(started.id),
			(r) => r?.status === "stopped",
			30_000,
		);
		await waitFor(
			() => alive(pid),
			(running) => !running,
			15_000,
		);
		const detail = await colleague.runs.get({ runId: started.id });
		expect(detail.steps.at(-1)?.outcome).toBe("stopped");
		expect(eventsOnA("OfferWithdrawn")).toEqual([
			{ deviceId: bId, profile: "coder", by: ownerOnA },
		]);
		expect((await b.client.offers.list()).offers).toEqual([]);
		writeFileSync(SLEEP_MS, "0");
		await expect(
			colleague.runs.start({ projectId, flowName: "offered", deviceId: bId }),
		).rejects.toThrow("It offers nothing to this Space.");
	}, 90_000);
});
