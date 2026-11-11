import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import { event } from "@nightshift/db/schema";
import { FLOW_VERSION, type Flow, type FlowNode } from "@nightshift/flows";
import { now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { defaultRunSettings } from "../device-config/settings";
import { parseEventRow } from "../log/events";
import type { WorktreeRemoval } from "../log/worktree-removals";
import { createEngine, type EngineInternals } from "../run/engine";
import type { SpaceEngine } from "../run/space-engine";
import { createRunFolders } from "../run-folders/run-folders";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";

/**
 * The files of a run of a project without a folder (ADR 22), through the
 * engine: the list the run page shows, one file of it, and the scheduled
 * cleanup of the run folders.
 */

const DAY_MS = 24 * 60 * 60_000;

let sandbox: Sandbox;
let daemons: AbortController[];

beforeEach(async () => {
	sandbox = await createSandbox();
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

const command = (id: string, line: string): FlowNode => ({
	id,
	type: "command",
	position: { x: 0, y: 0 },
	command: line,
	stdout: "text",
});

const gate: FlowNode = {
	id: "ask",
	type: "decision",
	position: { x: 0, y: 0 },
	prompt: "Go on?",
	options: [{ name: "pass" }],
	by: "person",
	decider: "typesafe",
} as FlowNode;

function flowOf(nodes: FlowNode[]): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges: nodes.slice(1).map((node, i) => ({
			id: `e${i}`,
			from: (nodes[i] as FlowNode).id,
			outcome: "pass",
			to: node.id,
		})),
	} as Flow;
}

const WRITE =
	"mkdir -p report && echo notes > notes.md && echo summary > report/summary.md";

/** Starts a quick run of `nodes` and waits until it is no longer running. */
async function runOf(
	engine: SpaceEngine,
	projectId: string,
	nodes: FlowNode[],
	until: (status: string) => boolean = (status) => status !== "running",
) {
	const started = await engine.startRun({ projectId, flow: flowOf(nodes) });
	return waitFor(
		async () => {
			const run = await engine.getRun(started.id);
			return until(run.status) ? run : null;
		},
		{ label: "the run", timeoutMs: 15_000 },
	);
}

async function removals() {
	const rows = await sandbox.db
		.select()
		.from(event)
		.where(eq(event.type, "WorktreeRemoved"));
	return rows.map(parseEventRow) as WorktreeRemoval[];
}

describe("the files of a run folder", () => {
	test("lists the files the run wrote, and when the cleanup removes them", async () => {
		const engine = startDaemon();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		const run = await runOf(engine, research.id, [command("write", WRITE)]);
		expect(run.status).toBe("finished");

		const listed = await engine.listRunFiles(run.id);
		expect(listed).toMatchObject({
			here: true,
			more: false,
			removed: null,
			cleanupAt: (run.endedAt ?? 0) + 90 * DAY_MS,
		});
		expect(listed.files.map((f) => [f.path, f.size])).toEqual([
			["notes.md", 6],
			["report/summary.md", 8],
		]);

		const found = await engine.runFile(run.id, "report/summary.md");
		expect(found?.file.path).toBe("report/summary.md");
		expect(await Bun.file(found?.path ?? "").text()).toBe("summary\n");
		expect(await engine.runFile(run.id, "gone.md")).toBeNull();
		await expect(engine.runFile(run.id, "../../x")).rejects.toThrow(
			"That is not a file of this run.",
		);
	}, 30_000);

	test("a run that goes on has no cleanup date; a run in a copy of the project has no files", async () => {
		const engine = startDaemon();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		const waiting = await runOf(
			engine,
			research.id,
			[command("write", WRITE), gate],
			(status) => status === "waiting",
		);
		expect(await engine.listRunFiles(waiting.id)).toMatchObject({
			here: true,
			cleanupAt: null,
		});

		const app = await engine.addProject({ repoPath: sandbox.repoPath });
		const inCopy = await runOf(engine, app.id, [command("write", WRITE)]);
		expect(await engine.listRunFiles(inCopy.id)).toEqual({
			here: false,
			files: [],
			more: false,
			cleanupAt: null,
			removed: null,
		});
		expect(await engine.runFile(inCopy.id, "notes.md")).toBeNull();
	}, 30_000);

	test("a run of another Space has no files for this one", async () => {
		const engine = startDaemon();
		await expect(engine.listRunFiles("nope")).rejects.toThrow();
		await expect(engine.runFile("nope", "notes.md")).rejects.toThrow();
	});
});

describe("the scheduled cleanup of run folders", () => {
	test("removes the folder of an ended run once its days have passed, and never an open run's", async () => {
		const engine = startDaemon();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		const ended = await runOf(engine, research.id, [command("write", WRITE)]);
		const open = await runOf(
			engine,
			research.id,
			[command("write", WRITE), gate],
			(status) => status === "waiting",
		);
		// A folder of a run this computer does not know: a step it ran for someone else.
		const folders = createRunFolders(sandbox.dataDir);
		const { path: stranger } = await folders.make("stranger-run");
		await writeFile(join(stranger, "notes.md"), "notes\n");
		const { path: recent } = await folders.make("recent-run");
		await writeFile(join(recent, "notes.md"), "notes\n");
		// The stranger's folder last changed a day ago, the recent one a day from now.
		const touch = async (folder: string, at: number) => {
			for (const path of [folder, join(folder, "notes.md")]) {
				await utimes(path, at / 1000, at / 1000);
			}
		};
		await touch(stranger, now() - DAY_MS);
		await touch(recent, now() + DAY_MS);
		for (const daemon of daemons) daemon.abort();

		// A restart 90 days later: the first sweep comes once the engine is ready.
		const later = startDaemon({
			now: () => now() + 90 * DAY_MS,
			cleanupDelayMs: 0,
		});
		await waitFor(async () => !existsSync(ended.worktreePath), {
			label: "the sweep",
		});
		await waitFor(async () => !existsSync(stranger), {
			label: "the folder of the run it does not know",
		});

		expect(existsSync(open.worktreePath)).toBe(true);
		expect(existsSync(recent)).toBe(true);
		// Logged for the run this computer knows only.
		expect((await removals()).map((e) => e.payload)).toEqual([
			{
				projectId: research.id,
				runId: ended.id,
				worktreePath: ended.worktreePath,
				branches: [],
				by: "cleanup",
			},
		]);
		expect(await later.listRunFiles(ended.id)).toMatchObject({
			here: false,
			files: [],
			cleanupAt: null,
			removed: { by: "cleanup" },
		});
	}, 30_000);

	test("does nothing when it is off, or before the days have passed", async () => {
		const engine = startDaemon();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		const run = await runOf(engine, research.id, [command("write", WRITE)]);
		const folders = createRunFolders(sandbox.dataDir);
		await mkdir(join(folders.path("stranger-run")), { recursive: true });
		for (const daemon of daemons) daemon.abort();

		startDaemon(
			{ now: () => now() + 200 * DAY_MS, cleanupDelayMs: 0, cleanupEveryMs: 5 },
			{ ...defaultRunSettings(), cleanUpRuns: false },
		);
		startDaemon({
			now: () => now() + 89 * DAY_MS,
			cleanupDelayMs: 0,
			cleanupEveryMs: 5,
		});
		await Bun.sleep(200);
		expect(existsSync(run.worktreePath)).toBe(true);
		expect(existsSync(folders.path("stranger-run"))).toBe(true);
		expect(await removals()).toEqual([]);
	}, 30_000);
});

describe("a project without a folder", () => {
	test("has no branches", async () => {
		const engine = startDaemon();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		expect(await engine.listBranches(research.id)).toEqual({
			current: null,
			local: [],
			remote: [],
		});
	});

	test("is in the list of projects the CLI tools read for their logins", async () => {
		const engine = startDaemon();
		const research = await engine.addProjectWithoutFolder({ name: "Research" });
		expect((await engine.listProjects()).map((p) => p.id)).toContain(
			research.id,
		);
	});
});
