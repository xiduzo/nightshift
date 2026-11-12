import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import { event } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { defaultRunSettings } from "../device-config/settings";
import { parseEventRow } from "../log/events";
import type { WorktreeRemoval } from "../log/worktree-removals";
import { createEngine, type EngineInternals } from "../run/engine";
import type { SpaceEngine } from "../run/space-engine";
import {
	createSandbox,
	mustGit,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";

/**
 * What runs leave in the clone, through the engine: the scheduled cleanup a
 * day after a run ends, the work it keeps out of sight until
 * `cleanUpAfterDays`, and the copy a rerun or a resume makes again.
 */

const DAY_MS = 24 * 60 * 60_000;
const GIT =
	"git -c user.name=t -c user.email=t@nightshift.invalid -c commit.gpgsign=false";
/** A commit of its own in each run (the folder makes the content differ), and one more on each visit of the step. */
const COMMIT = `pwd >> work.txt && git add work.txt && ${GIT} commit -q -m work`;

let sandbox: Sandbox;
let origin: string;
let daemons: AbortController[];

beforeEach(async () => {
	sandbox = await createSandbox();
	origin = join(sandbox.root, "origin.git");
	await mustGit(sandbox.root, ["init", "-q", "--bare", origin]);
	await mustGit(sandbox.repoPath, ["remote", "add", "origin", origin]);
	await mustGit(sandbox.repoPath, ["push", "-q", "origin", "main"]);
	await mustGit(sandbox.repoPath, [
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		"refs/remotes/origin/main",
	]);
	daemons = [];
});
afterEach(async () => {
	for (const daemon of daemons) daemon.abort();
	await Bun.sleep(20);
	await sandbox.cleanup();
});

function startDaemon(
	internals: EngineInternals = {},
	settings = defaultRunSettings(),
): SpaceEngine {
	const controller = new AbortController();
	daemons.push(controller);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
			scheduler: false,
			settings: () => settings,
		}),
		{ cleanupDelayMs: 60 * 60_000, signal: controller.signal, ...internals },
	).space(sandbox.spaceId);
}

/** Stops every daemon, then starts one `days` later whose first sweep comes once it is ready. */
async function sweptLater(
	days: number,
	settings = defaultRunSettings(),
): Promise<SpaceEngine> {
	for (const daemon of daemons) daemon.abort();
	// The test waits for the sweep's end, not for a time: git is slow on a busy computer.
	const swept = Promise.withResolvers<void>();
	const later = startDaemon(
		{
			now: () => now() + days * DAY_MS,
			cleanupDelayMs: 0,
			cleanupSwept: swept.resolve,
		},
		settings,
	);
	await swept.promise;
	return later;
}

function commandFlow(command: string): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "work",
		nodes: [
			{
				id: "work",
				type: "command",
				position: { x: 0, y: 0 },
				command,
				stdout: "text",
			},
		],
		edges: [],
	};
}

/** Waits until the run is no longer running. */
async function ended(engine: SpaceEngine, runId: string) {
	return waitFor(
		async () => {
			const run = await engine.getRun(runId);
			return run.status !== "running" ? run : null;
		},
		{ label: "the run to end", timeoutMs: 15_000 },
	);
}

/** Starts a quick run of one command and waits for its end. */
async function runCommand(
	engine: SpaceEngine,
	projectId: string,
	command: string,
) {
	const started = await engine.startRun({
		projectId,
		flow: commandFlow(command),
	});
	return ended(engine, started.id);
}

async function removals() {
	const rows = await sandbox.db
		.select()
		.from(event)
		.where(eq(event.type, "WorktreeRemoved"));
	return rows.map(parseEventRow) as WorktreeRemoval[];
}

/** The refs the cleanup kept, sorted. */
async function keptRefs(): Promise<string[]> {
	const out = await mustGit(sandbox.repoPath, [
		"for-each-ref",
		"--format=%(refname)",
		"refs/nightshift/kept/",
	]);
	return out.split("\n").filter(Boolean).toSorted();
}

async function localRunBranches(): Promise<string[]> {
	const out = await mustGit(sandbox.repoPath, [
		"branch",
		"--list",
		"nightshift/*",
		"--format=%(refname:short)",
	]);
	return out.split("\n").filter(Boolean);
}

/** The commits of the run's branch past `main`. */
async function workCommits(branch: string): Promise<number> {
	return Number(
		await mustGit(sandbox.repoPath, ["rev-list", "--count", `main..${branch}`]),
	);
}

const short = (runId: string) => runId.slice(0, 8);

describe("the scheduled cleanup", () => {
	test("a day after a run ends, its copy and branches go, and work only here is kept out of sight", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const empty = await runCommand(engine, project.id, "true");
		const pushed = await runCommand(
			engine,
			project.id,
			`${COMMIT} && git push -q origin HEAD`,
		);
		const unsaved = await runCommand(engine, project.id, COMMIT);
		const dirty = await runCommand(
			engine,
			project.id,
			`${COMMIT} && git push -q origin HEAD && echo x > loose.txt`,
		);
		const unsavedTip = await mustGit(sandbox.repoPath, [
			"rev-parse",
			unsaved.branch,
		]);

		await sweptLater(1.1);

		for (const run of [empty, pushed, unsaved, dirty]) {
			expect(existsSync(run.worktreePath)).toBe(false);
		}
		expect(await localRunBranches()).toEqual([]);
		expect(await keptRefs()).toEqual(
			[
				`refs/nightshift/kept/${short(unsaved.id)}/copy`,
				`refs/nightshift/kept/${short(unsaved.id)}/heads/${unsaved.branch}`,
				`refs/nightshift/kept/${short(dirty.id)}/copy`,
			].toSorted(),
		);
		expect(
			await mustGit(sandbox.repoPath, [
				"rev-parse",
				`refs/nightshift/kept/${short(unsaved.id)}/copy`,
			]),
		).toBe(unsavedTip);
		// The change that was not committed is in the kept copy.
		expect(
			await mustGit(sandbox.repoPath, [
				"show",
				`refs/nightshift/kept/${short(dirty.id)}/copy:loose.txt`,
			]),
		).toBe("x");
		// The branches on origin stay.
		expect(
			await mustGit(origin, ["branch", "--list", "nightshift/*"]),
		).toContain(pushed.branch);

		const byRun = new Map(
			(await removals()).map((e) => [e.payload.runId, e.payload]),
		);
		expect(byRun.get(empty.id)).toEqual({
			projectId: project.id,
			runId: empty.id,
			worktreePath: empty.worktreePath,
			branches: [empty.branch],
			by: "cleanup",
		});
		expect(byRun.get(unsaved.id)?.kept).toEqual([
			`refs/nightshift/kept/${short(unsaved.id)}/copy`,
			`refs/nightshift/kept/${short(unsaved.id)}/heads/${unsaved.branch}`,
		]);
		expect(byRun.get(pushed.id)?.kept).toBeUndefined();
	}, 60_000);

	test("work merged by a squash on origin needs no kept ref", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(engine, project.id, COMMIT);
		await mustGit(sandbox.repoPath, ["merge", "-q", "--squash", run.branch]);
		await mustGit(sandbox.repoPath, [
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@nightshift.invalid",
			"commit",
			"-q",
			"-m",
			"Squashed",
		]);
		await mustGit(sandbox.repoPath, ["push", "-q", "origin", "main"]);

		await sweptLater(2);
		expect(existsSync(run.worktreePath)).toBe(false);
		expect(await localRunBranches()).toEqual([]);
		expect(await keptRefs()).toEqual([]);
	}, 60_000);

	test("a copy on a branch of its own: the copy is kept, that branch stays", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(
			engine,
			project.id,
			`git checkout -q -b tune/1110 && ${COMMIT}`,
		);
		const tip = await mustGit(sandbox.repoPath, ["rev-parse", "tune/1110"]);

		await sweptLater(2);
		expect(existsSync(run.worktreePath)).toBe(false);
		expect(await localRunBranches()).toEqual([]);
		expect(
			await mustGit(sandbox.repoPath, ["rev-parse", "refs/heads/tune/1110"]),
		).toBe(tip);
		expect(await keptRefs()).toEqual([
			`refs/nightshift/kept/${short(run.id)}/copy`,
		]);
	}, 60_000);

	test("the kept work goes cleanUpAfterDays after the run ended", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(engine, project.id, COMMIT);

		await sweptLater(30);
		expect(await keptRefs()).toHaveLength(2);
		await sweptLater(91);
		expect(await keptRefs()).toEqual([]);
		const expired = (await removals()).find((e) => e.payload.expired);
		expect(expired?.payload).toMatchObject({
			runId: run.id,
			worktreePath: null,
			branches: [],
			by: "cleanup",
		});
		expect(expired?.payload.expired).toHaveLength(2);
	}, 60_000);

	test("does nothing when it is off, or before a day has passed", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(engine, project.id, COMMIT);
		await sweptLater(0.9);
		await sweptLater(120, { ...defaultRunSettings(), cleanUpRuns: false });
		expect(await removals()).toEqual([]);
		expect(existsSync(run.worktreePath)).toBe(true);
		expect(await localRunBranches()).toEqual([run.branch]);
	}, 60_000);

	test("never touches a run that is still open", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const started = await engine.startRun({
			projectId: project.id,
			flow: {
				version: FLOW_VERSION,
				inputs: [],
				outputs: [],
				start: "ask",
				nodes: [
					{
						id: "ask",
						type: "decision",
						position: { x: 0, y: 0 },
						prompt: "Go on?",
						options: [{ name: "yes" }],
						by: "person",
						decider: "typesafe",
					},
				],
				edges: [],
			},
		});
		await waitFor(
			async () => (await engine.getRun(started.id)).status === "waiting",
			{ label: "the Gate" },
		);
		await sweptLater(30);
		expect(existsSync(started.worktreePath)).toBe(true);
		expect(await localRunBranches()).toEqual([started.branch]);
		expect(await removals()).toEqual([]);
	}, 60_000);
});

describe("a run whose copy went", () => {
	test("a rerun makes the copy again from the work the cleanup kept", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(engine, project.id, COMMIT);
		const later = await sweptLater(2);
		expect(existsSync(run.worktreePath)).toBe(false);

		await later.act(run.id, { kind: "rerun", nodeId: "work" });
		const again = await ended(later, run.id);
		expect(again.status).toBe("finished");
		expect(existsSync(run.worktreePath)).toBe(true);
		// The first visit's commit came back, and the rerun added one.
		expect(await workCommits(run.branch)).toBe(2);
		expect(await keptRefs()).toEqual([]);
		expect(JSON.stringify(again)).toContain(
			"Night Shift made it again from the work it kept.",
		);
	}, 60_000);

	test("a resume makes the copy again from the run's branch on origin", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(
			engine,
			project.id,
			`${COMMIT} && git push -q origin HEAD && exit 3`,
		);
		expect(run.status).toBe("failed");
		const later = await sweptLater(2);
		expect(existsSync(run.worktreePath)).toBe(false);
		expect(await keptRefs()).toEqual([]);

		await later.act(run.id, { kind: "resume" });
		const again = await ended(later, run.id);
		expect(existsSync(run.worktreePath)).toBe(true);
		expect(await workCommits(run.branch)).toBe(2);
		expect(JSON.stringify(again)).toContain(
			"Night Shift made it again from the run's branch on the remote.",
		);
	}, 60_000);

	test("a rerun of a run that kept nothing starts again where the run started", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(engine, project.id, "true");
		const later = await sweptLater(2);
		expect(existsSync(run.worktreePath)).toBe(false);

		await later.act(run.id, { kind: "rerun", nodeId: "work" });
		const again = await ended(later, run.id);
		expect(again.status).toBe("finished");
		expect(existsSync(run.worktreePath)).toBe(true);
		expect(JSON.stringify(again)).toContain(
			"Night Shift made it again from where the run started.",
		);
	}, 60_000);
});
