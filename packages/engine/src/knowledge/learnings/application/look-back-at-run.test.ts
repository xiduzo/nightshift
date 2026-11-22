import { describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";
import {
	inMemoryLearner,
	inMemoryRunsToLearnFrom,
} from "../adapters/out/in-memory-neighbours";
import { createLookQueue, type EndedRun } from "../domain/look-back";
import type { LearningStep } from "../domain/signals";
import { lookBackAtRun } from "./look-back-at-run";
import type { ProposeFromRun } from "./propose-from-run";

/** The use case lookBackAtRun, on in-memory adapters. Twins of `run-learnings.test.ts`. */

function step(id: string, outcome: string): LearningStep {
	return {
		id,
		nodeId: "build",
		nodeType: "command",
		visit: id === "s1" ? 1 : 2,
		startedAt: id === "s1" ? 1 : 2,
		endedAt: 3,
		outcome,
		outputs: {},
		error: null,
		scope: null,
		gate: null,
	};
}

/** A run that ended: its build failed once, and a later try worked. */
function run(steps: LearningStep[]): EndedRun {
	return {
		id: "run-1",
		projectId: "p1",
		flowName: "nightly",
		status: "finished",
		reason: null,
		flow: { nodes: [] } as unknown as Flow,
		calledFlows: {},
		steps,
		createdAt: 10,
		endedAt: 20,
	};
}

function setup(answer: string[]) {
	const runs = inMemoryRunsToLearnFrom();
	const learner = inMemoryLearner(answer);
	const proposed: ProposeFromRun[] = [];
	const on = new Map<string, boolean>();
	const lookBack = lookBackAtRun({
		runs,
		learn: learner.learn,
		lines: (entries) => entries.map(() => "a line"),
		timeoutMs: 60_000,
		queue: createLookQueue(),
		learnsFromRuns: async ({ projectId }) => on.get(projectId) ?? true,
		known: async () => ["Known."],
		proposeFromRun: async (request) => {
			proposed.push(request);
		},
	});
	return { runs, learner, proposed, on, lookBack };
}

describe("lookBackAtRun", () => {
	test("a run with a signal gives the Learner its evidence, and proposes what it learned in the run's own file", async () => {
		const { runs, learner, proposed, lookBack } = setup(["Run make first."]);
		runs.runs.set("run-1", run([step("s1", "fail"), step("s2", "pass")]));
		runs.transcripts.set("run-1:s1", []);
		const found = await lookBack({ spaceId: "s1", runId: "run-1" });
		expect(found.signals.map((signal) => signal.kind)).toEqual(["fixed"]);
		expect(found.notes).toEqual(["Run make first."]);
		expect(learner.asked).toHaveLength(1);
		expect(learner.asked[0]?.evidence).toContain("- Known.");
		expect(proposed).toEqual([
			{ projectId: "p1", runId: "run-1", notes: ["Run make first."] },
		]);
	});

	test("a run without a signal writes nothing, and the Learner is not asked", async () => {
		const { runs, learner, proposed, lookBack } = setup(["No."]);
		runs.runs.set("run-1", run([step("s1", "pass")]));
		expect(await lookBack({ spaceId: "s1", runId: "run-1" })).toEqual({
			signals: [],
			notes: [],
		});
		expect(learner.asked).toEqual([]);
		expect(proposed).toEqual([]);
	});

	test("a project that turned it off gets nothing, whatever the run", async () => {
		const { runs, learner, on, lookBack } = setup(["No."]);
		on.set("p1", false);
		runs.runs.set("run-1", run([step("s1", "fail"), step("s2", "pass")]));
		expect(await lookBack({ spaceId: "s1", runId: "run-1" })).toEqual({
			signals: [],
			notes: [],
		});
		expect(learner.asked).toEqual([]);
	});
});
