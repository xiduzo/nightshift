import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentHarness } from "@nightshift/agents/types";
import { event } from "@nightshift/db/schema/nightshift";
import { asc } from "drizzle-orm";

import { createEngine } from "./engine";
import {
	createSandbox,
	mustGit,
	type Sandbox,
	scriptedHarness,
	waitFor,
} from "./test-support";
import type {
	Engine,
	RunStatus,
	RunStreamItem,
	StartRunInput,
	TranscriptEntry,
} from "./types";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

function makeEngine(
	harness: AgentHarness,
	options: { maxConcurrentSessions?: number } = {},
): Engine {
	return createEngine({
		db: sandbox.db,
		harnesses: { "claude-code": harness },
		dataDir: sandbox.dataDir,
		...options,
	});
}

async function startInput(
	engine: Engine,
	overrides: Partial<StartRunInput> = {},
): Promise<StartRunInput> {
	const project = await engine.addProject({ repoPath: sandbox.repoPath });
	return {
		projectId: project.id,
		prompt: "Fix the bug",
		model: "sonnet",
		permissionMode: "acceptEdits",
		...overrides,
	};
}

async function statusOf(engine: Engine, runId: string): Promise<RunStatus> {
	return (await engine.getRun(runId)).status;
}

async function waitForStatus(engine: Engine, runId: string, status: RunStatus) {
	await waitFor(async () => (await statusOf(engine, runId)) === status, {
		label: `status ${status}`,
	});
}

async function loggedEvents() {
	return sandbox.db.select().from(event).orderBy(asc(event.seq));
}

/** Watches a run until `until` says stop, and returns every item. */
async function collect(
	engine: Engine,
	runId: string,
	until: (item: RunStreamItem, items: RunStreamItem[]) => boolean,
	afterSeq?: number,
): Promise<RunStreamItem[]> {
	const controller = new AbortController();
	const items: RunStreamItem[] = [];
	const timeout = setTimeout(() => controller.abort(), 5_000);
	for await (const item of engine.watchRun(runId, {
		signal: controller.signal,
		afterSeq,
	})) {
		items.push(item);
		if (until(item, items)) controller.abort();
	}
	clearTimeout(timeout);
	return items;
}

const entriesOf = (items: RunStreamItem[]): TranscriptEntry[] =>
	items.flatMap((i) => (i.kind === "transcript" ? [i.entry] : []));
const statusesOf = (items: RunStreamItem[]): RunStatus[] =>
	items.flatMap((i) => (i.kind === "status" ? [i.status] : []));
const isStatus = (status: RunStatus) => (item: RunStreamItem) =>
	item.kind === "status" && item.status === status;

describe("projects", () => {
	test("addProject rejects a path that is not a git repository", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const plain = join(sandbox.root, "plain");
		await mkdir(plain);
		await expect(engine.addProject({ repoPath: plain })).rejects.toThrow(
			"Not a git repository",
		);
		expect(await engine.listProjects()).toEqual([]);
	});

	test("addProject stores the repo top level and is idempotent", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const first = await engine.addProject({ repoPath: sandbox.repoPath });
		expect(first.name).toBe("repo");
		expect(first.repoPath).toBe(sandbox.repoPath);
		const again = await engine.addProject({
			repoPath: `${sandbox.repoPath}/`,
			name: "other",
		});
		expect(again.id).toBe(first.id);
		expect(await engine.listProjects()).toHaveLength(1);
	});
});

describe("runs", () => {
	test("startRun creates the worktree and branch and returns at once", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const input = await startInput(engine, { effort: "high" });
		const head = await mustGit(sandbox.repoPath, ["rev-parse", "HEAD"]);

		const summary = await engine.startRun(input);
		expect(summary.status).toBe("running");
		expect(summary.baseRef).toBe(head);
		expect(summary.branch).toBe(`nightshift/${summary.id.slice(0, 8)}`);
		expect(summary.worktreePath).toBe(
			join(sandbox.root, "repo.nightshift", summary.id.slice(0, 8)),
		);
		expect(existsSync(join(summary.worktreePath, "README.md"))).toBe(true);
		expect(
			await mustGit(summary.worktreePath, [
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			]),
		).toBe(summary.branch);

		const session = await waitFor(() => sessions[0], { label: "session" });
		expect(session.input).toMatchObject({
			cwd: summary.worktreePath,
			prompt: "Fix the bug",
			model: "sonnet",
			permissionMode: "acceptEdits",
			effort: "high",
		});
		expect(session.input.resumeSessionId).toBeUndefined();

		session.text("Hello");
		session.finish(0.12);
		await waitForStatus(engine, summary.id, "finished");

		const detail = await engine.getRun(summary.id);
		expect(detail.costUsd).toBeCloseTo(0.12);
		expect(detail.sessions).toHaveLength(1);
		expect(detail.sessions[0]).toMatchObject({
			harnessSessionId: "harness-0",
			outcome: "finished",
			error: null,
			costUsd: 0.12,
		});
		expect(detail.takeOverCommand).toBe(
			`cd ${summary.worktreePath} && claude --resume harness-0`,
		);
		expect((await engine.listRuns())[0]).toMatchObject({
			id: summary.id,
			status: "finished",
		});

		const types = (await loggedEvents()).map((e) => e.type);
		expect(types).toEqual([
			"ProjectAdded",
			"RunStarted",
			"WorktreeCreated",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
		]);
		// Text deltas stay on disk, not in the event log.
		expect(JSON.stringify(await loggedEvents())).not.toContain("Hello");

		const transcript = await readFile(
			join(
				sandbox.dataDir,
				"transcripts",
				summary.id,
				`${detail.sessions[0]?.id}.ndjson`,
			),
			"utf8",
		);
		const lines = transcript
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as TranscriptEntry);
		expect(lines.map((l) => [l.seq, l.event.type])).toEqual([
			[1, "session"],
			[2, "text"],
			[3, "finished"],
		]);
	});

	test("a harness error makes the run failed", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun(await startInput(engine));
		(await waitFor(() => sessions[0])).fail("boom");
		await waitForStatus(engine, run.id, "failed");
		expect((await engine.getRun(run.id)).sessions[0]?.error).toBe("boom");
	});

	test("stopRun aborts the session and the run is stopped", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun(await startInput(engine));
		const session = await waitFor(() => sessions[0]);
		session.text("working");

		await engine.stopRun(run.id);
		expect(session.input.signal.aborted).toBe(true);
		const detail = await engine.getRun(run.id);
		expect(detail.status).toBe("stopped");
		expect(detail.sessions[0]?.outcome).toBe("stopped");
		const types = (await loggedEvents()).map((e) => e.type);
		expect(types).toContain("StopRequested");

		// Stopping a run that does not run is a no-op.
		await engine.stopRun(run.id);
		expect(await statusOf(engine, run.id)).toBe("stopped");
	});

	test("resumeRun continues the harness session and the seq numbering", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun(await startInput(engine));
		const first = await waitFor(() => sessions[0]);
		first.text("one");
		first.text("two");
		await engine.stopRun(run.id);

		await engine.resumeRun(run.id);
		const second = await waitFor(() => sessions[1], { label: "resume" });
		expect(second.input.resumeSessionId).toBe("harness-0");
		expect(second.input.prompt).toBe("Continue where you left off.");
		expect(second.input.cwd).toBe(run.worktreePath);
		await expect(engine.resumeRun(run.id)).rejects.toThrow("still running");

		second.text("three");
		second.finish(0.5);
		await waitForStatus(engine, run.id, "finished");

		const detail = await engine.getRun(run.id);
		expect(detail.sessions.map((s) => s.outcome)).toEqual([
			"stopped",
			"finished",
		]);
		expect(detail.takeOverCommand).toContain("--resume harness-1");
		expect(detail.costUsd).toBeCloseTo(0.5);

		const items = await collect(
			engine,
			run.id,
			(_item, all) => entriesOf(all).length === 7,
		);
		const entries = entriesOf(items);
		expect(entries.map((e) => [e.seq, e.event.type])).toEqual([
			[1, "session"],
			[2, "text"],
			[3, "text"],
			[4, "error"],
			[5, "session"],
			[6, "text"],
			[7, "finished"],
		]);
		expect(new Set(entries.map((e) => e.sessionId)).size).toBe(2);
	});

	test("resumeRun with a prompt passes it on", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun(await startInput(engine));
		(await waitFor(() => sessions[0])).finish();
		await waitForStatus(engine, run.id, "finished");
		await engine.resumeRun(run.id, "Also add tests");
		const second = await waitFor(() => sessions[1]);
		expect(second.input.prompt).toBe("Also add tests");
		second.finish();
		await waitForStatus(engine, run.id, "finished");
	});

	test("the concurrency cap refuses a session beyond it", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness, { maxConcurrentSessions: 1 });
		const input = await startInput(engine);
		const first = await engine.startRun(input);

		await expect(engine.startRun(input)).rejects.toThrow(
			"The session cap is reached: 1 of 1",
		);
		// The refused run left nothing behind.
		expect(await engine.listRuns()).toHaveLength(1);

		await engine.stopRun(first.id);
		const second = await engine.startRun(input);
		expect(second.status).toBe("running");
		await expect(engine.resumeRun(first.id)).rejects.toThrow(
			"The session cap is reached",
		);
		(await waitFor(() => sessions[1])).finish();
		await waitForStatus(engine, second.id, "finished");
	});

	test("starting two runs at once cannot pass the cap", async () => {
		const { harness } = scriptedHarness();
		const engine = makeEngine(harness, { maxConcurrentSessions: 1 });
		const input = await startInput(engine);
		const results = await Promise.allSettled([
			engine.startRun(input),
			engine.startRun(input),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const runs = await engine.listRuns();
		for (const run of runs) await engine.stopRun(run.id);
	});
});

describe("watchRun", () => {
	test("replays from disk, then streams live, with no gaps or duplicates", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun(await startInput(engine));
		const session = await waitFor(() => sessions[0]);
		for (let i = 0; i < 20; i++) session.text(`before-${i}`);
		await waitFor(async () => (await readTranscriptCount(run.id)) === 21, {
			label: "21 entries on disk",
		});

		// Keep emitting while the watcher subscribes and replays.
		const producer = (async () => {
			for (let i = 0; i < 50; i++) {
				session.text(`during-${i}`);
				if (i % 5 === 0) await Bun.sleep(0);
			}
			session.finish(0.01);
		})();
		const items = await collect(engine, run.id, isStatus("finished"));
		await producer;

		expect(items[0]).toEqual({ kind: "status", status: "running" });
		expect(statusesOf(items)).toEqual(["running", "finished"]);
		const seqs = entriesOf(items).map((e) => e.seq);
		// 1 session + 20 before + 50 during + 1 finished
		expect(seqs).toEqual(Array.from({ length: 72 }, (_, i) => i + 1));
		expect(items.at(-1)).toEqual({ kind: "status", status: "finished" });
	});

	test("afterSeq skips entries the caller has", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun(await startInput(engine));
		const session = await waitFor(() => sessions[0]);
		session.text("a");
		session.text("b");
		session.finish();
		await waitForStatus(engine, run.id, "finished");

		const items = await collect(
			engine,
			run.id,
			(_item, all) => entriesOf(all).length === 2,
			2,
		);
		expect(items[0]).toEqual({ kind: "status", status: "finished" });
		expect(entriesOf(items).map((e) => e.seq)).toEqual([3, 4]);
	});

	test("ends cleanly when the signal aborts while waiting", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun(await startInput(engine));
		await waitFor(() => sessions[0]);
		const controller = new AbortController();
		const items: RunStreamItem[] = [];
		const done = (async () => {
			for await (const item of engine.watchRun(run.id, {
				signal: controller.signal,
			})) {
				items.push(item);
			}
		})();
		await waitFor(() => items.length >= 2, { label: "replay" });
		controller.abort();
		await done;
		expect(items[0]).toEqual({ kind: "status", status: "running" });
		await engine.stopRun(run.id);
	});

	test("rejects an unknown run", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const iterator = engine
			.watchRun("missing", { signal: new AbortController().signal })
			[Symbol.asyncIterator]();
		await expect(iterator.next()).rejects.toThrow("Run not found");
	});
});

describe("recovery", () => {
	test("a session the daemon lost is interrupted, and resume continues seq", async () => {
		// The first daemon's harness never ends: the daemon "dies" mid-session.
		const dying = scriptedHarness({ hang: true });
		const first = makeEngine(dying.harness);
		const run = await first.startRun(await startInput(first));
		const lost = await waitFor(() => dying.sessions[0]);
		lost.text("partial work");
		await waitFor(async () => (await readTranscriptCount(run.id)) === 2);

		// A new daemon on the same database and data directory.
		const { harness, sessions } = scriptedHarness({
			harnessSessionId: () => "harness-0",
		});
		const second = makeEngine(harness);
		const detail = await second.getRun(run.id);
		expect(detail.status).toBe("interrupted");
		expect(detail.sessions[0]?.outcome).toBe("interrupted");
		expect(detail.takeOverCommand).toContain("--resume harness-0");

		await second.resumeRun(run.id);
		const resumed = await waitFor(() => sessions[0]);
		expect(resumed.input.resumeSessionId).toBe("harness-0");
		resumed.finish();
		await waitForStatus(second, run.id, "finished");

		const items = await collect(
			second,
			run.id,
			(_i, all) => entriesOf(all).length === 4,
		);
		expect(entriesOf(items).map((e) => e.seq)).toEqual([1, 2, 3, 4]);
		const ended = (await loggedEvents()).filter(
			(e) => e.type === "SessionEnded",
		);
		expect(ended.map((e) => JSON.parse(e.payload).outcome)).toEqual([
			"interrupted",
			"finished",
		]);
	});
});

async function readTranscriptCount(runId: string): Promise<number> {
	const dir = join(sandbox.dataDir, "transcripts", runId);
	if (!existsSync(dir)) return 0;
	const files = await Array.fromAsync(new Bun.Glob("*.ndjson").scan(dir));
	let count = 0;
	for (const file of files) {
		const text = await readFile(join(dir, file), "utf8");
		count += text.split("\n").filter(Boolean).length;
	}
	return count;
}
