import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppRouterClient } from "@nightshift/api";
import type { RunSummary } from "@nightshift/engine";
import { type InferClientInputs, ORPCError } from "@orpc/client";

import {
	type Daemon,
	hostClient,
	pair,
	startDaemon,
	stopDaemon,
	waitFor,
} from "../test-daemons";

/**
 * The event log exchange between two daemons: A is the Host, B pairs with
 * it. B walks a run in A's Space; A's Replica gets it as it goes, answers
 * its Gate (B applies the answer), and opens the transcript from the
 * archive. A Space B's owner is not in never reaches B; a row of another
 * Walker is refused; B keeps walking while A is down and A catches up.
 */

const root = mkdtempSync(join(tmpdir(), "nightshift-exchange-"));
const REMOTE = "https://example.com/acme/app.git";

/** A flow as `runs.start` takes it inline. */
type Flow = Extract<
	InferClientInputs<AppRouterClient>["runs"]["start"],
	{ flow: unknown }
>["flow"];

let a: Daemon;
let b: Daemon;
let aId: string;
let bId: string;
/** A's Person's personal Space: the Space B takes part in. */
let spaceId: string;
let projectId: string;

async function repo(name: string): Promise<string> {
	const path = join(root, name);
	mkdirSync(path, { recursive: true });
	const git = async (...args: string[]) => {
		const child = Bun.spawn(
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
			{ cwd: path, stdout: "ignore", stderr: "pipe" },
		);
		if ((await child.exited) !== 0) {
			throw new Error(await new Response(child.stderr).text());
		}
	};
	await Bun.write(join(path, "README.md"), `# ${name}\n`);
	await git("init", "-q", "-b", "main");
	await git("remote", "add", "origin", REMOTE);
	await git("add", "README.md");
	await git("commit", "-q", "-m", "initial");
	return path;
}

/** A command, then a Gate: B's run waits for an answer. */
const gateFlow: Flow = {
	version: 5,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo hello from B",
			output: "text",
		},
		{
			id: "ship",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "approve" }, { name: "reject" }],
			by: "person",
			decider: "typesafe",
		},
	],
	edges: [{ id: "e1", from: "hello", outcome: "pass", to: "ship" }],
} as Flow;

/** One command step: a run that ends on its own. */
const quickFlow: Flow = {
	version: 5,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo while the Host was away",
			output: "text",
		},
	],
	edges: [],
} as Flow;

async function runOn(daemon: Daemon, runId: string) {
	return (await daemon.client.runs.list()).find((r) => r.id === runId);
}

/** B's Device key on A, as B keeps it (in a file: NIGHTSHIFT_KEY_STORE=file). */
function keyOfB(): string {
	return readFileSync(join(b.dataDir, "device-keys", aId), "utf8").trim();
}

beforeAll(async () => {
	[a, b] = await Promise.all([
		startDaemon(root, "a", { NIGHTSHIFT_HOST: "on" }),
		startDaemon(root, "b", {}),
	]);
	aId = (await a.client.devices.list()).thisComputer?.id as string;
	bId = await pair(a, b);
	await waitFor(
		async () => (await b.client.devices.list()).thisComputer?.hosts ?? [],
		(hosts) => hosts[0]?.status === "online",
	);
}, 90_000);

afterAll(async () => {
	await Promise.all([stopDaemon(a), stopDaemon(b)]);
	rmSync(root, { recursive: true, force: true });
});

describe("the event log exchange", () => {
	test("B walks a run in A's Space; A sees it live, answers its Gate, and opens its transcript", async () => {
		// A's project, in A's personal Space.
		const added = await a.client.projects.add({ repoPath: await repo("on-a") });
		projectId = added.id;
		spaceId = (await a.client.spaces.list()).active as string;

		// The Space reaches B: B's Person works in it as A's Person does on A.
		const listed = await waitFor(
			async () => (await b.client.spaces.list()).spaces,
			(spaces) => spaces.some((s) => s.id === spaceId),
		);
		expect(listed.find((s) => s.id === spaceId)).toMatchObject({
			personal: false,
			role: "owner",
		});
		await b.client.spaces.switch({ spaceId });

		// The project is listed on B before B has a folder of it.
		const listedOnB = await waitFor(
			() => b.client.projects.list(),
			(projects) => projects.some((p) => p.id === projectId),
		);
		expect(listedOnB.find((p) => p.id === projectId)?.repoPath).toBeNull();
		// Its flows come from A's Clone, through A.
		expect(await b.client.flows.list({ projectId })).toEqual([]);

		// B's folder of the same remote is a Clone of A's project, known on A.
		const folder = await repo("on-b");
		const clone = await waitFor(
			() => b.client.projects.add({ repoPath: folder }).catch(() => null),
			(project) => project !== null,
		);
		expect(clone?.id).toBe(projectId);
		const onA = await waitFor(
			async () =>
				(await a.client.projects.list()).find((p) => p.id === projectId),
			(project) => (project?.clones.length ?? 0) === 2,
		);
		expect(onA?.clones.map((c) => [c.deviceId, c.thisDevice])).toEqual([
			[aId, true],
			[bId, false],
		]);

		// B walks a run; it waits at its Gate.
		const started = await b.client.runs.start({ projectId, flow: gateFlow });
		await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "waiting",
		);

		// A's Replica has it, with the same status, walked by B.
		const seen = (await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "waiting",
		)) as RunSummary;
		expect(seen.walker).toMatchObject({ id: bId, thisDevice: false });
		// Started by the Person A knows, with B's paths: B is A's owner's own Device.
		const personOfA = (await a.client.settings.get()).daemon.device.ownerId;
		expect(seen.startedBy?.id).toBe(personOfA);
		expect(seen.startedBy?.name).toBeTruthy();
		expect(seen.worktreePath).not.toBe("");
		expect(seen.walker.name).toBeTruthy();
		const gate = await waitFor(
			async () =>
				(await a.client.gates.list()).find((g) => g.runId === started.id),
			(g) => g !== undefined,
		);
		expect(gate?.walker.id).toBe(bId);
		expect(gate?.answerPending).toBe(false);

		// A's Person answers it on A; B applies it and the run finishes on both.
		await a.client.gates.resolve({
			runId: started.id,
			stepId: gate?.stepId as string,
			choice: "approve",
			note: "Ship it from A.",
		});
		await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "finished",
		);
		const finished = await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished",
		);
		expect(finished?.reason).toBe((await runOn(b, started.id))?.reason);
		const detail = await waitFor(
			() => a.client.runs.get({ runId: started.id }),
			(d) => d.commands.length === 0,
		);
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["hello", "pass"],
			["ship", "approve"],
		]);
		expect(detail.steps[1]?.outputs.note).toBe("Ship it from A.");
		expect(detail.takeOverCommand).toBeNull();

		// A opens the command step's transcript: it comes from the archive.
		const controller = new AbortController();
		const stream = await a.client.runs.watch(
			{ runId: started.id },
			{ signal: controller.signal },
		);
		let output = "";
		for await (const item of stream) {
			if (item.kind === "transcript") output += JSON.stringify(item.entry);
			if (output.includes("hello from B")) break;
		}
		controller.abort();
		expect(output).toContain("hello from B");
	}, 90_000);

	test("a Space B's owner is not a Member of never reaches B", async () => {
		// Another Person's Space on A, with a run of A's own.
		const db = new Database(join(a.dataDir, "nightshift.db"));
		const now = Date.now();
		db.run(
			"insert into user (id, name, email, email_verified, created_at, updated_at) values ('stranger', 'Stranger', 'stranger@example.invalid', 0, ?, ?)",
			[now, now],
		);
		db.run(
			"insert into organization (id, name, slug, created_at, personal) values ('space-private', 'Private', 'space-private', ?, 0)",
			[now],
		);
		db.run(
			"insert into member (id, organization_id, user_id, role, created_at) values ('m-stranger', 'space-private', 'stranger', 'owner', ?)",
			[now],
		);
		db.run(
			"insert into project (id, space_id, name, remote, created_at) values ('project-private', 'space-private', 'Private', null, ?)",
			[now],
		);
		db.run(
			"insert into run (id, space_id, project_id, flow_name, flow, body_flows, title, worktree_path, branch, base_ref, walker_id, created_at) values ('run-private', 'space-private', 'project-private', null, '{}', '{}', 'Private run', '/nowhere', 'nightshift/private', 'main', ?, ?)",
			[aId, now],
		);
		db.run(
			"insert into event (space_id, run_id, type, payload, created_at, walker_id, walker_seq) values ('space-private', 'run-private', 'RunStarted', '{}', ?, ?, 1000000)",
			[now, aId],
		);
		db.close();

		const host = hostClient(a.url, { key: keyOfB() });
		const pulled = await host.sync.pull({ cursors: {} });
		expect(pulled.rows.runs.map((r) => r.spaceId)).not.toContain(
			"space-private",
		);
		expect(pulled.rows.events.map((e) => e.runId)).not.toContain("run-private");
		expect(Object.keys(pulled.cursors)).not.toContain("space-private");
		// And not by the archive either.
		expect(
			await host.archive.get({
				ref: {
					kind: "checkpoint",
					spaceId: "space-private",
					runId: "run-private",
				},
			}),
		).toBeNull();

		const replica = new Database(join(b.dataDir, "nightshift.db"), {
			readonly: true,
		});
		const leaked = replica
			.query("select id from run where space_id = 'space-private'")
			.all();
		replica.close();
		expect(leaked).toEqual([]);
	}, 30_000);

	test("a row of another Walker is refused, and so is a Space B's owner is not in", async () => {
		const host = hostClient(a.url, { key: keyOfB() });
		const run = {
			id: "run-forged",
			spaceId,
			projectId,
			flowName: null,
			flow: "{}",
			bodyFlows: "{}",
			title: "Forged",
			worktreePath: "/nowhere",
			branch: "nightshift/forged",
			baseRef: "main",
			walkerId: "someone-else",
			createdAt: Date.now(),
		};
		const event = {
			spaceId,
			runId: "run-forged",
			stepId: null,
			sessionId: null,
			type: "RunStarted",
			payload: "{}",
			at: Date.now(),
			walkerId: "someone-else",
			walkerSeq: 1,
		};
		const refused = await host.sync
			.push({ runs: [run], steps: [], sessions: [], events: [event] })
			.catch((error) => error);
		expect(refused).toBeInstanceOf(ORPCError);
		expect((refused as ORPCError<string, unknown>).code).toBe("FORBIDDEN");

		// B's own Walker, in a Space its owner is not in: refused as well.
		const elsewhere = await host.sync
			.push({
				runs: [{ ...run, walkerId: bId, spaceId: "space-private" }],
				steps: [],
				sessions: [],
				events: [{ ...event, walkerId: bId, spaceId: "space-private" }],
			})
			.catch((error) => error);
		expect((elsewhere as ORPCError<string, unknown>).code).toBe("FORBIDDEN");
		expect(await runOn(a, "run-forged")).toBeUndefined();
	}, 30_000);

	test("B keeps walking while A is down, and A catches up when it is back", async () => {
		await stopDaemon(a);
		await waitFor(
			async () => (await b.client.devices.list()).thisComputer?.hosts ?? [],
			(hosts) => hosts[0]?.status === "offline",
		);

		const started = await b.client.runs.start({ projectId, flow: quickFlow });
		await waitFor(
			() => runOn(b, started.id),
			(r) => r?.status === "finished",
		);

		a = await startDaemon(root, "a", a.env, a.port);
		const caught = await waitFor(
			() => runOn(a, started.id),
			(r) => r?.status === "finished",
			60_000,
		);
		expect(caught?.walker.id).toBe(bId);
	}, 120_000);
});
