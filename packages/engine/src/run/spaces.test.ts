import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import {
	agentSession,
	clone,
	event,
	project,
	run,
	step,
} from "@nightshift/db/schema";
import type { DecisionNode, Flow } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import type { Engine } from "../contract/engine";
import { createRunLog, type RunLog } from "../log/run-log";
import {
	createSpaceDocuments,
	type SpaceDocuments,
	spaceProjects,
} from "../projects/space-document";
import { aloneDirectory } from "../testing/alone-directory";
import {
	commitFile,
	createSandbox,
	expectRunLogsInSync,
	mustGit,
	otherSpace,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { GateClosedError } from "./actions";
import { createEngine, type EngineInternals } from "./engine";

/**
 * Spaces: every row carries its Space, and a Space's view of the engine
 * never reads, returns or changes another Space's rows.
 */

let sandbox: Sandbox;
let runLogs: RunLog[];
let signal: AbortController;
let documents: SpaceDocuments;
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
	signal = new AbortController();
	documents = createSpaceDocuments({
		db: sandbox.db,
		directory: aloneDirectory(sandbox.db),
	});
});
afterEach(async () => {
	signal.abort();
	try {
		await expectRunLogsInSync(sandbox.db, runLogs);
	} finally {
		await documents.close();
		await sandbox.cleanup();
	}
});

function makeEngine(internals: EngineInternals = {}): Engine {
	const runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			spaceDocuments: documents,
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
	version: 5,
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
		const notFound = "Night Shift cannot find this run.";
		await expect(other.getRun(started.id)).rejects.toMatchObject({
			kind: "not-found",
			message: notFound,
		});
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
		const projectGone = "Night Shift cannot find this project.";
		await expect(other.listFlows(added.id)).rejects.toMatchObject({
			kind: "not-found",
			message: projectGone,
		});
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

	test("each Space lists its own open Gates, and a run names its Space", async () => {
		const engine = makeEngine();
		const mine = engine.space(sandbox.spaceId);
		const platform = await otherSpace(sandbox.db, "Platform");
		const theirs = engine.space(platform);
		const secondRepo = join(sandbox.root, "second");
		await mkdir(secondRepo, { recursive: true });
		await mustGit(secondRepo, ["init", "-q", "-b", "main"]);
		await commitFile(secondRepo, "README.md");

		const ours = await mine.addProject({ repoPath: sandbox.repoPath });
		const other = await theirs.addProject({ repoPath: secondRepo });
		const first = await mine.startRun({ projectId: ours.id, flow });
		const second = await theirs.startRun({ projectId: other.id, flow });
		await waitFor(
			async () =>
				(await mine.getRun(first.id)).status === "waiting" &&
				(await theirs.getRun(second.id)).status === "waiting",
			{ label: "both Gates" },
		);

		const gatesOf = async (view: typeof mine) =>
			(await view.listGates()).map((g) => [g.spaceId, g.runId]);
		expect(await gatesOf(mine)).toEqual([[sandbox.spaceId, first.id]]);
		expect(await gatesOf(theirs)).toEqual([[platform, second.id]]);
		expect(await engine.spaceOfRun(first.id)).toBe(sandbox.spaceId);
		expect(await engine.spaceOfRun(second.id)).toBe(platform);
		expect(await engine.spaceOfRun("no-such-run")).toBeNull();

		// The answer is bound to its run and step, and refused once the Gate is closed.
		const [open] = await theirs.listGates();
		if (!open) throw new Error("no Gate");
		await theirs.resolveGate({
			runId: second.id,
			stepId: open.stepId,
			choice: "no",
		});
		expect(await theirs.listGates()).toEqual([]);
		await expect(
			theirs.resolveGate({
				runId: second.id,
				stepId: open.stepId,
				choice: "yes",
			}),
		).rejects.toBeInstanceOf(GateClosedError);
		expect(await gatesOf(mine)).toEqual([[sandbox.spaceId, first.id]]);
		await mine.stopRun(first.id);
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

	test("a moved project takes its Clones, runs, steps, sessions and events along", async () => {
		const engine = makeEngine();
		const mine = engine.space(sandbox.spaceId);
		const platform = await otherSpace(sandbox.db, "Platform");
		const theirs = engine.space(platform);

		const added = await mine.addProject({ repoPath: sandbox.repoPath });
		const started = await mine.startRun({ projectId: added.id, flow });
		await waitFor(
			async () => (await mine.getRun(started.id)).status === "waiting",
			{ label: "the Gate" },
		);

		await mine.moveProject(added.id, platform);

		for (const table of [project, clone, run, step, agentSession, event]) {
			const spaces = new Set(
				(await sandbox.db.select({ space: table.spaceId }).from(table)).map(
					(r) => r.space,
				),
			);
			expect(spaces).toEqual(new Set([platform]));
		}
		// The new Space has it, Gate and all; the old one does not.
		expect(await mine.listProjects()).toEqual([]);
		await expect(mine.getRun(started.id)).rejects.toThrow(
			"Night Shift cannot find this run.",
		);
		expect((await theirs.listProjects()).map((p) => p.id)).toEqual([added.id]);
		expect(await theirs.listGates()).toHaveLength(1);
		const [moved] = await sandbox.db
			.select({ payload: event.payload })
			.from(event)
			.where(eq(event.type, "ProjectMoved"));
		expect(JSON.parse(moved?.payload ?? "{}")).toEqual({
			projectId: added.id,
			from: sandbox.spaceId,
			to: platform,
		});

		// Both documents follow.
		const before = await documents.open(sandbox.spaceId);
		const after = await documents.open(platform);
		expect(spaceProjects(before).has(added.id)).toBe(false);
		expect(before.clones.size).toBe(0);
		expect(spaceProjects(after).get(added.id)?.name).toBe(added.name);
		expect([...after.clones.keys()]).toEqual([
			`${added.id}/${sandbox.deviceId}`,
		]);

		await theirs.stopRun(started.id);
	});

	test("a move to a Space that does not exist is refused", async () => {
		const mine = makeEngine().space(sandbox.spaceId);
		const added = await mine.addProject({ repoPath: sandbox.repoPath });
		await expect(mine.moveProject(added.id, "nowhere")).rejects.toThrow(
			"That Space does not exist.",
		);
		expect((await mine.listProjects()).map((p) => p.id)).toEqual([added.id]);
	});
});
