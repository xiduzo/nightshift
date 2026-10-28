import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import { event } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
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

/** What runs leave on this computer, through the engine: the overview, the two actions and the sweep. */

const DAY_MS = 24 * 60 * 60_000;
/** A commit of its own in each run: the folder makes the content differ. */
const COMMIT =
	"pwd > work.txt && git add work.txt && git -c user.name=t -c user.email=t@nightshift.invalid -c commit.gpgsign=false commit -q -m work";

let sandbox: Sandbox;
let daemons: AbortController[];

beforeEach(async () => {
	sandbox = await createSandbox();
	const origin = join(sandbox.root, "origin.git");
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

function commandFlow(command: string): Flow {
	return {
		version: 7,
		inputs: [],
		outputs: [],
		start: "work",
		nodes: [
			{
				id: "work",
				type: "command",
				position: { x: 0, y: 0 },
				command,
				output: "text",
			},
		],
		edges: [],
	};
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
	return waitFor(
		async () => {
			const run = await engine.getRun(started.id);
			return run.status !== "running" ? run : null;
		},
		{ label: "the run to end", timeoutMs: 15_000 },
	);
}

async function removals() {
	const rows = await sandbox.db
		.select()
		.from(event)
		.where(eq(event.type, "WorktreeRemoved"));
	return rows.map(parseEventRow) as WorktreeRemoval[];
}

describe("the overview and the actions of a person", () => {
	test("lists a run's copy and branch, removes the copy, then deletes the branch on confirmation", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(engine, project.id, COMMIT);
		expect(run.status).toBe("finished");

		const overview = await engine.listRunCopies(project.id);
		expect(overview.defaultBranch).toBe("main");
		expect(overview.copies).toHaveLength(1);
		expect(overview.copies[0]).toMatchObject({
			runId: run.id,
			active: false,
			copy: true,
			changes: 0,
			safe: false,
			cleanupAt: null,
			removed: null,
			branches: [
				{ name: run.branch, merged: false, pushed: false, unsaved: 1 },
			],
		});

		await expect(engine.deleteRunBranches(run.id)).rejects.toThrow(
			"Remove the run's copy of the project first",
		);
		await engine.removeRunCopy(run.id);
		expect(existsSync(run.worktreePath)).toBe(false);

		await expect(engine.deleteRunBranches(run.id)).rejects.toThrow(
			"1 commit of this run is only on this computer",
		);
		await engine.deleteRunBranches(run.id, { force: true });

		const after = await engine.listRunCopies(project.id);
		expect(after.copies).toHaveLength(1);
		expect(after.copies[0]).toMatchObject({
			copy: false,
			branches: [],
			removed: { by: "person" },
		});
		expect((await removals()).map((e) => e.payload)).toEqual([
			{
				projectId: project.id,
				runId: run.id,
				worktreePath: run.worktreePath,
				branches: [],
				by: "person",
			},
			{
				projectId: project.id,
				runId: run.id,
				worktreePath: null,
				branches: [run.branch],
				by: "person",
			},
		]);
	}, 30_000);

	test("changes that are not committed go only on confirmation", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(engine, project.id, "echo x > loose.txt");
		const [copy] = (await engine.listRunCopies(project.id)).copies;
		expect(copy).toMatchObject({ changes: 1, safe: false });

		await expect(engine.removeRunCopy(run.id)).rejects.toThrow(
			"changes that are not committed",
		);
		expect(existsSync(run.worktreePath)).toBe(true);
		await engine.removeRunCopy(run.id, { force: true });
		expect(existsSync(run.worktreePath)).toBe(false);
	}, 30_000);

	test("never touches a run that is still open", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const started = await engine.startRun({
			projectId: project.id,
			flow: {
				version: 7,
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
		const [copy] = (await engine.listRunCopies(project.id)).copies;
		expect(copy).toMatchObject({ active: true, cleanupAt: null });
		await expect(
			engine.removeRunCopy(started.id, { force: true }),
		).rejects.toThrow("This run is still going");
		await expect(
			engine.deleteRunBranches(started.id, { force: true }),
		).rejects.toThrow();
		expect(existsSync(started.worktreePath)).toBe(true);
	}, 30_000);
});

describe("the scheduled cleanup", () => {
	test("removes old runs whose work is merged or pushed, and keeps the rest", async () => {
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
		const [copy] = (await engine.listRunCopies(project.id)).copies.filter(
			(c) => c.runId === pushed.id,
		);
		expect(copy?.safe).toBe(true);
		expect(copy?.cleanupAt).toBeGreaterThan(Date.now() + 13 * DAY_MS);
		for (const daemon of daemons) daemon.abort();

		// A restart 15 days later: the first sweep comes once the engine is ready.
		const later = startDaemon({
			now: () => Date.now() + 15 * DAY_MS,
			cleanupDelayMs: 0,
		});
		await waitFor(async () => (await removals()).length === 2, {
			label: "the sweep",
		});

		expect(existsSync(empty.worktreePath)).toBe(false);
		expect(existsSync(pushed.worktreePath)).toBe(false);
		expect(existsSync(unsaved.worktreePath)).toBe(true);
		expect(existsSync(dirty.worktreePath)).toBe(true);
		const local = await mustGit(sandbox.repoPath, [
			"branch",
			"--list",
			"nightshift/*",
			"--format=%(refname:short)",
		]);
		expect(local.split("\n").toSorted()).toEqual(
			[unsaved.branch, dirty.branch].toSorted(),
		);
		// The branch on origin stays.
		expect(
			await mustGit(join(sandbox.root, "origin.git"), [
				"branch",
				"--list",
				pushed.branch,
			]),
		).toContain(pushed.branch);
		expect(
			(await removals())
				.map((e) => `${e.payload.runId} ${e.payload.by}`)
				.toSorted(),
		).toEqual([`${empty.id} cleanup`, `${pushed.id} cleanup`].toSorted());

		const kept = await later.listRunCopies(project.id);
		expect(
			kept.copies
				.filter((c) => c.removed === null)
				.map((c) => c.runId)
				.toSorted(),
		).toEqual([unsaved.id, dirty.id].toSorted());
	}, 30_000);

	test("does nothing when it is off, or before the days have passed", async () => {
		const engine = startDaemon();
		const project = await engine.addProject({ repoPath: sandbox.repoPath });
		const run = await runCommand(engine, project.id, "true");
		for (const daemon of daemons) daemon.abort();

		startDaemon({ now: () => Date.now() + 13 * DAY_MS, cleanupDelayMs: 0 });
		startDaemon(
			{ now: () => Date.now() + 30 * DAY_MS, cleanupDelayMs: 0 },
			{ ...defaultRunSettings(), cleanUpRuns: false },
		);
		await Bun.sleep(500);
		expect(await removals()).toEqual([]);
		expect(existsSync(run.worktreePath)).toBe(true);
	}, 30_000);
});
