import { describe, expect, test } from "bun:test";
import { ATTR, OPERATION } from "@nightshift/semconv";
import { recordsOf } from "./run-records";
import type { TracedRun, TracedStepEnd } from "./traced-run";

/**
 * The records of one landed fact, without an export. `wire.test.ts`
 * checks what reaches the export, on the in-memory engine.
 */

const end = (over: Partial<TracedStepEnd> = {}): TracedStepEnd => ({
	seq: 5,
	openedAt: 1_000,
	at: 3_000,
	outcome: "success",
	error: null,
	costUsd: null,
	costBasis: "reported",
	first: true,
	sessions: [
		{
			harness: "claude-code",
			model: "sonnet",
			costUsd: 0.5,
			costBasis: "reported",
			tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
		},
	],
	gateWaits: [],
	sleeps: [],
	knowledge: { searches: 0, reads: 0 },
	...over,
});

const run = (over: Partial<TracedRun> = {}): TracedRun => ({
	runId: "run-1",
	projectId: "project-1",
	flowName: "nightly",
	trigger: "manual",
	startedAt: 500,
	ends: [
		{
			seq: 9,
			openedAt: 500,
			at: 4_000,
			status: "finished",
			reason: null,
			endReason: "finished",
			first: true,
			neededYou: false,
		},
	],
	steps: [
		{
			id: "step-1",
			nodeId: "write",
			nodeType: "agent",
			visit: 1,
			parentStepId: null,
			deviceId: null,
			ends: [end(), end({ seq: 7, first: false })],
		},
	],
	test: false,
	...over,
});

describe("the records of a landed fact", () => {
	test("an Agent step's first end: its span under the run, then its points", () => {
		const records = recordsOf(
			run(),
			{ kind: "step-ended", stepId: "step-1", seq: 5 },
			"here",
		);
		const [span, ...points] = records;
		expect(span).toMatchObject({
			kind: "span",
			name: `${OPERATION.agent} write`,
			runId: "run-1",
			span: { of: "step", stepId: "step-1" },
			parent: { of: "run", runId: "run-1" },
			from: 1_000,
			to: 3_000,
			error: null,
		});
		expect(span?.attributes[ATTR.deviceId]).toBe("here");
		expect(points.map((p) => p.kind === "point" && p.instrument)).toEqual([
			"agentDuration",
			"cost",
			"inputTokens",
			"outputTokens",
		]);
	});

	test("a later end of a reopened step is a span of its own part", () => {
		const [span] = recordsOf(
			run(),
			{ kind: "step-ended", stepId: "step-1", seq: 7 },
			"here",
		);
		expect(span).toMatchObject({
			span: { of: "later", id: "step-1", seq: 7 },
		});
	});

	test("a test run writes only what its steps spent", () => {
		const testRun = run({ test: true });
		const records = recordsOf(
			testRun,
			{ kind: "step-ended", stepId: "step-1", seq: 5 },
			"here",
		);
		expect(records.map((r) => r.kind === "point" && r.instrument)).toEqual([
			"cost",
			"inputTokens",
			"outputTokens",
		]);
		expect(recordsOf(testRun, { kind: "run-ended", seq: 9 }, "here")).toEqual(
			[],
		);
	});

	test("a fact whose step or end the run does not have writes nothing", () => {
		expect(
			recordsOf(run(), { kind: "step-ended", stepId: "gone", seq: 5 }, "here"),
		).toEqual([]);
		expect(recordsOf(run(), { kind: "run-ended", seq: 1 }, "here")).toEqual([]);
	});

	test("the run's first end is the trace's root", () => {
		const [span, duration, outcome] = recordsOf(
			run(),
			{ kind: "run-ended", seq: 9 },
			"here",
		);
		expect(span).toMatchObject({
			kind: "span",
			span: { of: "run", runId: "run-1" },
			parent: null,
			from: 500,
			to: 4_000,
		});
		expect(duration).toMatchObject({
			instrument: "workflowDuration",
			value: 3.5,
		});
		expect(outcome).toMatchObject({ instrument: "runOutcome", value: 1 });
	});
});
