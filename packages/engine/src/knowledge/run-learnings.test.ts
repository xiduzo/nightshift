import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness } from "@nightshift/agents/testing";
import {
	type CommandNode,
	type DecisionNode,
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	PROPOSED_LEARNINGS_DIR,
} from "@nightshift/flows";
import { createRunLog, type RunLog } from "../log/run-log";
import { transcriptLines } from "../read/transcript-lines";
import { createEngine, type Engine } from "../run/engine";
import { testKnowledge } from "../testing/knowledge";
import {
	createSandbox,
	expectRunLogsInSync,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { type AskLearner, createRunLearnings } from "./run-learnings";

/**
 * Learnings from runs that ended (ADR 37), end to end: a real engine walks
 * a run, the look back follows its end, and a fake Learner answers. A run
 * a person answered with a reason gets a proposed learning, in the run's
 * own file. A run with no signal gets nothing, and the Learner is never
 * asked.
 */

let sandbox: Sandbox;
let runLogs: RunLog[];
let stops: (() => void)[];
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
	stops = [];
});
afterEach(async () => {
	for (const stop of stops) stop();
	try {
		await expectRunLogsInSync(sandbox.db, runLogs);
	} finally {
		await sandbox.cleanup();
	}
});

function command(id: string, cmd: string): CommandNode {
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: cmd,
		stdout: "text",
	};
}

const approve: DecisionNode = {
	id: "approve",
	type: "decision",
	label: "Approve the release",
	position: { x: 0, y: 0 },
	prompt: "Ship it?",
	options: [{ name: "yes" }, { name: "no" }],
	by: "person",
	decider: "typesafe",
};

function flowOf(nodes: Flow["nodes"], edges: FlowEdge[] = []): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
	};
}

/** An engine, a Knowledge, and the look back over both with a fake Learner. */
function setup(answer: string[]) {
	const runLog = createRunLog(sandbox.db, {
		walkerId: sandbox.deviceId,
		dataDir: sandbox.dataDir,
	});
	runLogs.push(runLog);
	const engine: Engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
		}),
		{ runLog },
	);
	const knowledge = testKnowledge(sandbox);
	stops.push(() => knowledge.close());
	const asked: Parameters<AskLearner>[0][] = [];
	const learnings = createRunLearnings({
		runs: engine,
		knowledge: knowledge.knowledge,
		learn: async (input) => {
			asked.push(input);
			return answer;
		},
		lines: transcriptLines,
	});
	stops.push(learnings.follow());
	return { engine, knowledge, learnings, asked };
}

async function ended(
	engine: Engine,
	runId: string,
	status = "finished",
): Promise<void> {
	await waitFor(
		async () =>
			(await engine.space(sandbox.spaceId).getRun(runId)).status === status,
		{ label: `status ${status}` },
	);
}

describe("learnings from runs that ended", () => {
	test("a Gate answered with a reason gives a proposed learning in the run's own file", async () => {
		const { engine, knowledge, asked } = setup([
			"Release only from Monday to Thursday.",
		]);
		const space = engine.space(sandbox.spaceId);
		const projectId = (await space.addProject({ repoPath: sandbox.repoPath }))
			.id;
		const run = await space.startRun({
			projectId,
			flow: flowOf(
				[command("build", "echo built"), approve, command("ship", "true")],
				[
					{ id: "e1", from: "build", outcome: "pass", to: "approve" },
					{ id: "e2", from: "approve", outcome: "no", to: "ship" },
				],
			),
		});
		const open = await waitFor(
			async () => (await space.listGates()).find((g) => g.runId === run.id),
			{ label: "an open gate" },
		);
		await space.act(run.id, {
			kind: "answer",
			stepId: open.stepId,
			choice: "no",
			note: "Never release on a Friday.",
		});
		await ended(engine, run.id);

		const file = join(
			knowledge.folder(projectId),
			...PROPOSED_LEARNINGS_DIR.split("/"),
			`${run.id}.md`,
		);
		const text = await waitFor(
			async () => readFile(file, "utf8").catch(() => null),
			{ label: "the run's learnings" },
		);
		expect(text).toBe(
			`# Learnings of run ${run.id.slice(0, 8)}\n\nWhat Night Shift learned from run ${run.id}.\n\n- Release only from Monday to Thursday.\n`,
		);
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			spaceId: sandbox.spaceId,
			projectId,
			runId: run.id,
		});
		expect(asked[0]?.evidence).toContain(
			'The person chose "no" and wrote: "Never release on a Friday."',
		);
		expect(asked[0]?.evidence).toContain("Approve the release (approve)");

		// It waits for a person, as the Review page lists it: the run's, no step.
		const waiting = await waitFor(
			async () => {
				const list = await knowledge.knowledge.learnings([projectId]);
				return list.length > 0 ? list : null;
			},
			{ label: "a learning that waits" },
		);
		expect(waiting).toMatchObject([
			{
				id: `${run.id}.md`,
				runId: run.id,
				stepId: null,
				notes: ["Release only from Monday to Thursday."],
			},
		]);
		// The next look back reads it, so the Learner does not propose it again.
		expect(await knowledge.knowledge.knownLearnings(projectId)).toEqual([
			"Release only from Monday to Thursday.",
		]);
	});

	test("a run without a signal writes nothing, and the Learner is not asked", async () => {
		const { engine, knowledge, learnings, asked } = setup(["Never."]);
		const space = engine.space(sandbox.spaceId);
		const projectId = (await space.addProject({ repoPath: sandbox.repoPath }))
			.id;
		const run = await space.startRun({
			projectId,
			flow: flowOf([command("build", "echo built")]),
		});
		await ended(engine, run.id);

		expect(await learnings.lookBack(sandbox.spaceId, run.id)).toEqual({
			signals: [],
			notes: [],
		});
		await learnings.idle();
		expect(asked).toEqual([]);
		const proposed = join(
			knowledge.folder(projectId),
			...PROPOSED_LEARNINGS_DIR.split("/"),
		);
		expect(await readdir(proposed).catch(() => [])).toEqual([]);
	});

	test("a project that turned it off gets nothing, whatever the run", async () => {
		const { engine, knowledge, learnings, asked } = setup(["Never."]);
		const space = engine.space(sandbox.spaceId);
		const projectId = (await space.addProject({ repoPath: sandbox.repoPath }))
			.id;
		await knowledge.knowledge.setLearnsFromRuns(projectId, false);
		expect(await knowledge.knowledge.learnsFromRuns(projectId)).toBe(false);
		const run = await space.startRun({
			projectId,
			flow: flowOf([command("build", "exit 1")]),
		});
		await ended(engine, run.id, "failed");
		// The run before failed the same way: a signal, but the project said no.
		const again = await space.startRun({
			projectId,
			flow: flowOf([command("build", "exit 1")]),
		});
		await ended(engine, again.id, "failed");

		expect(await learnings.lookBack(sandbox.spaceId, again.id)).toEqual({
			signals: [],
			notes: [],
		});
		expect(asked).toEqual([]);
	});
});
