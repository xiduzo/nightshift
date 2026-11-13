import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";
import {
	evidenceSteps,
	learningEvidence,
	MAX_EVIDENCE_CHARS,
} from "./run-evidence";
import {
	failedAt,
	type LearningRun,
	type LearningStep,
	learningSignals,
} from "./run-signals";

const flow: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	inputs: [],
	start: "build",
	nodes: [
		{
			id: "build",
			type: "command",
			label: "Build it",
			position: { x: 0, y: 0 },
			command: "make",
		},
		{
			id: "approve",
			type: "decision",
			label: "Approve",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "yes" }, { name: "no" }],
			by: "person",
		},
	],
	edges: [],
});

let at = 0;
function step(
	id: string,
	nodeId: string,
	outcome: string | null,
	extra: Partial<LearningStep> = {},
): LearningStep {
	at += 10;
	return {
		id,
		nodeId,
		nodeType: nodeId === "approve" ? "decision" : "command",
		visit: 1,
		startedAt: at,
		endedAt: outcome === null ? null : at + 5,
		outcome,
		outputs: {},
		error: null,
		scope: null,
		gate: null,
		...extra,
	};
}

function run(
	id: string,
	steps: LearningStep[],
	extra: Partial<LearningRun> = {},
): LearningRun {
	return {
		id,
		flowName: "release",
		status: "finished",
		reason: null,
		flow,
		calledFlows: {},
		steps,
		neededYou: [],
		...extra,
	};
}

/** A Gate step a person answered, with what they wrote. */
function answered(id: string, choice: string, note: string) {
	const gate = step(id, "approve", choice, {
		outputs: { outcome: choice, note, visit: 1 },
		gate: { question: "Ship it?" },
	});
	return {
		gate,
		act: { reason: "gate", at: gate.startedAt + 1, nodeId: "approve" },
	};
}

describe("learningSignals", () => {
	test("a run where every step held has none", () => {
		expect(
			learningSignals(run("r1", [step("s1", "build", "pass")]), null),
		).toEqual([]);
	});

	test("a failed step that a later try fixed", () => {
		const signals = learningSignals(
			run("r1", [
				step("s1", "build", "fail", { error: "No space left." }),
				step("s2", "build", "pass", { visit: 2 }),
			]),
			null,
		);
		expect(signals).toEqual([
			{ kind: "fixed", nodeId: "build", failedStepId: "s1", fixedStepId: "s2" },
		]);
	});

	test("a failure that no try fixed is no fix", () => {
		const signals = learningSignals(
			run("r1", [step("s1", "build", "fail"), step("s2", "build", "stopped")], {
				status: "failed",
			}),
			null,
		);
		expect(signals).toEqual([]);
	});

	test("a person's answer to a Gate with a reason", () => {
		const { gate, act } = answered("s2", "no", "Never release on a Friday.");
		const signals = learningSignals(
			run("r1", [step("s1", "build", "pass"), gate], { neededYou: [act] }),
			null,
		);
		expect(signals).toEqual([
			{
				kind: "gate-reason",
				nodeId: "approve",
				stepId: "s2",
				choice: "no",
				note: "Never release on a Friday.",
			},
		]);
	});

	test("an answer with no reason, and a deadline's note, are none", () => {
		const { gate, act } = answered("s1", "yes", "");
		expect(
			learningSignals(run("r1", [gate], { neededYou: [act] }), null),
		).toEqual([]);
		// The deadline chose: no person stepped in, whatever the note says.
		const late = step("s2", "approve", "yes", {
			outputs: {
				note: 'Nobody answered by the deadline, so Night Shift chose "yes".',
			},
			gate: { question: "Ship it?" },
		});
		expect(learningSignals(run("r2", [late]), null)).toEqual([]);
	});

	test("an agent that needed input, and an answer after the tries ran out", () => {
		const agent = step("s1", "write", "needs-input", { nodeType: "agent" });
		const fallback = step("s2", "approve", "yes", {
			gate: { question: "Ship it?" },
		});
		const signals = learningSignals(
			run("r1", [agent, fallback], {
				neededYou: [
					{
						reason: "gate",
						at: fallback.startedAt + 1,
						nodeId: "approve",
						planned: false,
					},
				],
			}),
			null,
		);
		expect(signals).toEqual([
			{ kind: "asked", nodeId: "write", stepId: "s1" },
			{ kind: "asked", nodeId: "approve", stepId: "s2" },
		]);
	});

	test("the same failure as the run before", () => {
		const before = run("r0", [step("p1", "build", "fail")], {
			status: "failed",
		});
		const now = run("r1", [step("s1", "build", "fail")], { status: "failed" });
		expect(learningSignals(now, before)).toEqual([
			{
				kind: "same-failure",
				nodeId: "build",
				stepId: "s1",
				previousRunId: "r0",
				previousStepId: "p1",
			},
		]);
	});

	test("a failure of the run before that this run passed", () => {
		const before = run("r0", [step("p1", "build", "error")], {
			status: "failed",
		});
		const now = run("r1", [step("s1", "build", "pass")]);
		expect(learningSignals(now, before)).toEqual([
			{
				kind: "fixed-since",
				nodeId: "build",
				previousRunId: "r0",
				previousStepId: "p1",
				fixedStepId: "s1",
			},
		]);
	});

	test("a run before that held is no signal", () => {
		const before = run("r0", [step("p1", "build", "pass")]);
		expect(
			learningSignals(run("r1", [step("s1", "build", "pass")]), before),
		).toEqual([]);
	});

	test("a test run has none", () => {
		const fixed = [step("s1", "build", "fail"), step("s2", "build", "pass")];
		expect(
			learningSignals(
				run("r1", fixed, { test: { pinned: [], skipped: [] } }),
				null,
			),
		).toEqual([]);
	});

	test("the run failed at its last failed step, not the Subflow around it", () => {
		const inner = step("s2", "build", "fail", {
			scope: { parentStepId: "s1", itemId: null },
		});
		const outer = step("s1", "call", "fail");
		expect(failedAt(run("r1", [outer, inner]))?.id).toBe("s2");
	});
});

describe("learningEvidence", () => {
	const { gate, act } = answered("s3", "no", "Never release on a Friday.");
	const fixedRun = run(
		"r1",
		[
			step("s1", "build", "fail", { error: "No space left on device." }),
			step("s2", "build", "pass", {
				visit: 2,
				outputs: { log_tail: "Cleaned the cache, then built." },
			}),
			gate,
		],
		{ neededYou: [act] },
	);
	const signals = learningSignals(fixedRun, null);

	test("holds the run, why it is worth a look, what failed, what worked and the answer", () => {
		const evidence = learningEvidence({
			run: fixedRun,
			previous: null,
			signals,
			transcripts: new Map([["s1", ["$ make", "No space left on device."]]]),
			known: ["Builds run on the big runner."],
		});
		expect(evidence).toContain("Flow: release. Status: finished.");
		expect(evidence).toContain(
			"The step Build it (build) failed, and a later try of it worked.",
		);
		expect(evidence).toContain(
			'The person chose "no" and wrote: "Never release on a Friday."',
		);
		expect(evidence).toContain("Error: No space left on device.");
		expect(evidence).toContain("$ make");
		expect(evidence).toContain("It reported: Cleaned the cache, then built.");
		expect(evidence).toContain("- Builds run on the big runner.");
	});

	test("stays within its size, however long the transcripts and the learnings", () => {
		const evidence = learningEvidence({
			run: fixedRun,
			previous: null,
			signals,
			transcripts: new Map([["s1", Array(5_000).fill("x".repeat(200))]]),
			known: Array(2_000).fill("A learning the project already has."),
		});
		expect(evidence.length).toBeLessThanOrEqual(MAX_EVIDENCE_CHARS);
		expect(evidence).toContain("more");
	});

	test("reads the transcripts of the steps that went wrong, of both runs", () => {
		const before = run("r0", [step("p1", "build", "fail")]);
		const now = run("r1", [step("s1", "build", "fail")]);
		expect(evidenceSteps(learningSignals(now, before))).toEqual({
			run: ["s1"],
			previous: ["p1"],
		});
		expect(evidenceSteps(signals)).toEqual({ run: ["s1"], previous: [] });
	});
});
