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

import {
	type Daemon,
	pair,
	startDaemon,
	stopDaemon,
	waitFor,
} from "../test-daemons";

/**
 * Run-level Placement between two daemons: A is the Host and walks the
 * run; B paired with it and has the only Clone of the project. Every step
 * runs on B (a command, and an agent on a fake Claude Code), its events
 * land in A's run log, and A writes the transcript. A stop on A ends B's
 * session. A run placed on a Device of another Person is refused.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), "nightshift-placement-")));
const REMOTE = "https://example.com/acme/placed.git";
const FAKE_CLAUDE = fixturePath("fake-claude.ts");
/** Each fake Claude Code session on B writes its pid here. */
const PIDS = join(root, "claude-pids");
/** How long the fake session on B takes, read when it starts. */
const SLEEP_MS = join(root, "claude-sleep-ms");

let a: Daemon;
let b: Daemon;
let bId: string;
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
		{ cwd, stdout: "ignore", stderr: "pipe" },
	);
	if (child.exitCode !== 0) throw new Error(child.stderr.toString());
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

/** A flow file in B's Clone: the only copy of the project's flows. */
function flowOnB(name: string, nodes: unknown[], edges: unknown[] = []) {
	const dir = join(folderOnB, ".nightshift", "flows");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${name}.json`),
		JSON.stringify({
			version: 5,
			inputs: [],
			outputs: [],
			start: (nodes[0] as { id: string }).id,
			nodes,
			edges,
		}),
	);
}

const agentNode = {
	id: "work",
	type: "agent",
	position: { x: 0, y: 0 },
	prompt: "Do the work.",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "auto",
};

function pids(): number[] {
	try {
		return readFileSync(PIDS, "utf8").split("\n").filter(Boolean).map(Number);
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

async function runOnA(runId: string) {
	return (await a.client.runs.list()).find((r) => r.id === runId);
}

beforeAll(async () => {
	// B's Claude Code: the fake, which says where it runs.
	const claude = join(root, "claude");
	writeFileSync(
		claude,
		`#!/bin/sh\necho $$ >> '${PIDS}'\nexport FAKE_CLAUDE_SLEEP_MS=$(cat '${SLEEP_MS}' 2>/dev/null || echo 0)\nexec '${process.execPath}' '${FAKE_CLAUDE}' "$@"\n`,
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

	// A's project, in A's personal Space; B's folder of it is a Clone.
	const folderOnA = repo("on-a");
	projectId = (await a.client.projects.add({ repoPath: folderOnA })).id;
	const spaceId = (await a.client.spaces.list()).active as string;
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
	// A's own folder goes: only B has the project now.
	const db = new Database(join(a.dataDir, "nightshift.db"));
	db.run("delete from clone where project_id = ?", [projectId]);
	db.close();
	rmSync(folderOnA, { recursive: true, force: true });
}, 120_000);

afterAll(async () => {
	await Promise.all([stopDaemon(a), stopDaemon(b)]);
	rmSync(root, { recursive: true, force: true });
});

describe("a run placed on another Device", () => {
	test("A walks it, its steps run on B, and their events and transcript land on A", async () => {
		const placements = await waitFor(
			() => a.client.runs.placements({ projectId }),
			(list) => list.length > 0,
		);
		expect(placements).toEqual([
			{ deviceId: bId, name: expect.any(String), thisDevice: false },
		]);
		// B asks its Host: B itself, the only Device with a Clone.
		expect(await b.client.runs.placements({ projectId })).toEqual([
			{ deviceId: bId, name: expect.any(String), thisDevice: true },
		]);

		flowOnB(
			"placed",
			[
				{
					id: "where",
					type: "command",
					position: { x: 0, y: 0 },
					command: "pwd",
					output: "text",
				},
				agentNode,
			],
			[{ id: "e1", from: "where", outcome: "pass", to: "work" }],
		);
		// A reads the flows from B's Clone.
		expect(
			(await a.client.flows.list({ projectId })).map((f) => f.name),
		).toEqual(["placed"]);

		const started = await a.client.runs.start({
			projectId,
			flowName: "placed",
			deviceId: bId,
		});
		expect(started.walker.thisDevice).toBe(true);
		expect(started.device).toMatchObject({ id: bId, thisDevice: false });
		expect(started.worktreePath.startsWith(join(root, "on-b.nightshift"))).toBe(
			true,
		);

		await waitFor(
			() => runOnA(started.id),
			(r) => r?.status === "finished",
			60_000,
		);
		const detail = await a.client.runs.get({ runId: started.id });
		expect(
			detail.steps.map((s) => [s.nodeId, s.outcome, s.device?.id]),
		).toEqual([
			["where", "pass", bId],
			["work", "pass", bId],
		]);
		expect(String(detail.steps[0]?.outputs.log_tail).trim()).toBe(
			started.worktreePath,
		);

		// The agent's transcript is on A, as its Walker wrote it.
		const controller = new AbortController();
		const stream = await a.client.runs.watch(
			{ runId: started.id },
			{ signal: controller.signal },
		);
		const types: string[] = [];
		for await (const item of stream) {
			if (item.kind === "transcript") types.push(item.entry.event.type);
			if (types.includes("finished")) break;
		}
		controller.abort();
		expect(types).toEqual(
			expect.arrayContaining(["command-start", "session", "finished"]),
		);
	}, 120_000);

	test("a stop on A ends B's session", async () => {
		writeFileSync(SLEEP_MS, "60000");
		flowOnB("slow", [agentNode]);
		const before = pids().length;
		const started = await a.client.runs.start({
			projectId,
			flowName: "slow",
			deviceId: bId,
		});
		await waitFor(
			() => pids(),
			(list) => list.length > before,
			30_000,
		);
		const pid = pids().at(-1) as number;
		expect(alive(pid)).toBe(true);

		await a.client.runs.stop({ runId: started.id });
		await waitFor(
			() => runOnA(started.id),
			(r) => r?.status === "stopped",
			30_000,
		);
		await waitFor(
			() => alive(pid),
			(running) => !running,
			15_000,
		);
		writeFileSync(SLEEP_MS, "0");
	}, 90_000);

	test("a run placed on a Device of another Person is refused", async () => {
		const db = new Database(join(a.dataDir, "nightshift.db"));
		const now = Date.now();
		db.run(
			"insert into user (id, name, email, email_verified, created_at, updated_at) values ('colleague', 'Colleague', 'colleague@example.invalid', 0, ?, ?)",
			[now, now],
		);
		db.run(
			"insert into device (id, name, platform, owner_id, self, created_at) values ('device-colleague', 'colleague-laptop', 'linux', 'colleague', 0, ?)",
			[now],
		);
		db.close();
		flowOnB("hello", [
			{
				id: "hi",
				type: "command",
				position: { x: 0, y: 0 },
				command: "echo hi",
				output: "text",
			},
		]);
		await expect(
			a.client.runs.start({
				projectId,
				flowName: "hello",
				deviceId: "device-colleague",
			}),
		).rejects.toThrow("colleague-laptop is not your device.");
	}, 30_000);
});
