import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/fake";
import {
	agentSession,
	clone,
	event,
	project,
	run,
	step,
} from "@nightshift/db/schema/nightshift";
import type { DecisionNode, Flow } from "@nightshift/flows";

import { createEngine, type EngineInternals } from "./engine";
import { createRunLog, type RunLog } from "./run-log";
import {
	createSandbox,
	expectRunLogsInSync,
	otherSpace,
	type Sandbox,
	waitFor,
	withDevice,
} from "./test-support";
import type { Engine } from "./types";

/**
 * Spaces: every row carries its Space, and a Space's view of the engine
 * never reads, returns or changes another Space's rows.
 */

let sandbox: Sandbox;
let runLogs: RunLog[];
let signal: AbortController;
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
	signal = new AbortController();
});
afterEach(async () => {
	signal.abort();
	try {
		await expectRunLogsInSync(sandbox.db, runLogs);
	} finally {
		await sandbox.cleanup();
	}
});

function makeEngine(internals: EngineInternals = {}): Engine {
	const runLog = createRunLog(sandbox.db);
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
		}),
		{ runLog, signal: signal.signal, ...internals },
	);
}

const gate: DecisionNode = {
	id: "ship",
	type: "decision",
	position: { x: 0, y: 0 },
	prompt: "Ship it?",
	options: [{ name: "yes" }, { name: "no" }],
	by: "person",
	decider: "typesafe",
};

/** An Agent step, then a Gate: the run waits with a step, a session and events. */
const flow: Flow = {
	version: 4,
	inputs: [],
	outputs: [],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "agent",
			position: { x: 0, y: 0 },
			prompt: "Fix it.",
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "acceptEdits",
			session: "fresh",
		},
		gate,
	],
	edges: [{ id: "e1", from: "work", outcome: "pass", to: "ship" }],
};

describe("Spaces", () => {
	test("a Space sees and touches only its own projects, runs and Gates", async () => {
		const engine = makeEngine();
		const mine = engine.space(sandbox.spaceId);
		const other = engine.space(await otherSpace(sandbox.db));

		const added = await mine.addProject({ repoPath: sandbox.repoPath });
		const started = await mine.startRun({ projectId: added.id, flow });
		await waitFor(
			async () => (await mine.getRun(started.id)).status === "waiting",
			{ label: "the Gate" },
		);
		expect(await mine.listGates()).toHaveLength(1);

		expect(await other.listProjects()).toEqual([]);
		expect(await other.listRuns()).toEqual([]);
		expect(await other.listRuns({ projectId: added.id })).toEqual([]);
		expect(await other.listGates()).toEqual([]);
		const notFound = `Run not found: ${started.id}`;
		await expect(other.getRun(started.id)).rejects.toThrow(notFound);
		await expect(other.stopRun(started.id)).rejects.toThrow(notFound);
		await expect(other.resumeRun(started.id)).rejects.toThrow(notFound);
		await expect(other.signalRun(started.id, "go")).rejects.toThrow(notFound);
		await expect(
			other.resolveGate({
				runId: started.id,
				stepId: "any",
				choice: "yes",
			}),
		).rejects.toThrow(notFound);
		const watching = other.watchRun(started.id, {
			signal: new AbortController().signal,
		});
		await expect(watching[Symbol.asyncIterator]().next()).rejects.toThrow(
			notFound,
		);
		const projectGone = `Project not found: ${added.id}`;
		await expect(other.listFlows(added.id)).rejects.toThrow(projectGone);
		await expect(other.listSchedules(added.id)).rejects.toThrow(projectGone);
		await expect(other.removeProject(added.id)).rejects.toThrow(projectGone);
		await expect(other.startRun({ projectId: added.id, flow })).rejects.toThrow(
			projectGone,
		);
		// The same folder is not a second project in another Space.
		await expect(
			other.addProject({ repoPath: sandbox.repoPath }),
		).rejects.toThrow("This folder is a project in another Space.");

		// The run still waits in its own Space.
		expect((await mine.getRun(started.id)).status).toBe("waiting");
		await mine.stopRun(started.id);
	});

	test("every row a run writes carries its project's Space", async () => {
		const mine = makeEngine().space(sandbox.spaceId);
		const added = await mine.addProject({ repoPath: sandbox.repoPath });
		const started = await mine.startRun({ projectId: added.id, flow });
		await waitFor(
			async () => (await mine.getRun(started.id)).status === "waiting",
			{ label: "the Gate" },
		);
		await mine.stopRun(started.id);

		const spaces = async (
			table:
				| typeof project
				| typeof clone
				| typeof run
				| typeof step
				| typeof agentSession
				| typeof event,
		) =>
			new Set(
				(await sandbox.db.select({ space: table.spaceId }).from(table)).map(
					(r) => r.space,
				),
			);
		for (const table of [project, clone, run, step, agentSession, event]) {
			expect(await spaces(table)).toEqual(new Set([sandbox.spaceId]));
		}
		expect((await sandbox.db.select().from(step)).length).toBeGreaterThan(0);
		expect(
			(await sandbox.db.select().from(agentSession)).length,
		).toBeGreaterThan(0);
	});
});
