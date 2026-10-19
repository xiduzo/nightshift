import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Command } from "@langchain/langgraph";

import { deriveSteps, type EngineEventType } from "../events";
import { createSandbox, type Sandbox } from "../test-support";
import { STOP_AFTER_STEP_REASON, STOP_TIME_REASON } from "./context";
import { RESUME_RULES, type ResumePoint } from "./resume-point";
import type { PendingWait, RunStateValues } from "./state";
import { type BodyResult, runStep, type StepHandle } from "./step-runner";
import {
	command,
	edge,
	flowOf,
	type Harness,
	payloads,
	startRun,
} from "./test-support";

/**
 * The step runner's lifecycle as a table: how a step enters (a new visit,
 * or a step continued after a wait) crossed with what the run and the body
 * do (a stop, a stop after the step, the stop time, the step cap, the node's
 * time budget, an abort mid-body, a body that throws, a body that asks for a
 * wait, a body that ends). The body is a fake that returns what the row
 * says; the node and the flow are the same for every row. The expectations
 * are the log that `runStep` writes and the `Command` it returns, so the
 * node tests need not re-test this skeleton.
 */

const NODE = command("n", "true", { timeoutMinutes: 1 });
/** One minute of the node's time budget, in the rows that run out of it. */
const SHORT_MINUTE = 20;
const FLOW = flowOf(
	[NODE, command("after", "true")],
	[edge("e1", "n", "pass", "after")],
);

const stateOf = (extra: Partial<RunStateValues> = {}): RunStateValues => ({
	inputs: {},
	stopAt: null,
	wrappingUp: false,
	nodes: {},
	visits: {},
	traversals: {},
	loops: {},
	pending: null,
	ended: null,
	...extra,
});

type Situation =
	| "none"
	| "stop-requested"
	| "stop-after-step"
	| "past-stop-time"
	| "step-cap"
	| "time-budget";
type Behaviour =
	| "ends"
	| "aborts-mid-body"
	| "throws"
	| "requests-wait"
	| "stop-requested-ends"
	| "runs-until-aborted";

type Row = {
	entry: "new" | "continued";
	situation: Situation;
	body: Behaviour;
	/** The event types the run of this row appends, after what the entry setup wrote. */
	appends: EngineEventType[];
	goto: string;
	/** The body was called. */
	ran: boolean;
	pending?: Partial<Record<string, unknown>>;
};

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** Runs the body of a row through the runner and says what it did. */
async function runRow(row: Row) {
	const controller = new AbortController();
	const h: Harness = await startRun(sandbox, FLOW, {
		signal: controller.signal,
	});
	let ctx = h.ctx;
	let state = stateOf();
	const config = { configurable: { thread_id: h.runId } };
	const seen: ResumePoint[] = [];

	// A continued entry: a first visit waited, so the log has an open step
	// and `pending` names it (what the wait node hands back on a wake).
	if (row.entry === "continued") {
		const first = await runStep(ctx, NODE, state, config, {
			rules: RESUME_RULES.model,
			body: async () => ({
				kind: "wait",
				reason: "usage-limit",
				message: "limit",
				resetAt: null,
				harnessSessionId: null,
			}),
		});
		const pending = (first.update as { pending: PendingWait }).pending;
		expect(pending.kind).toBe("wait");
		state = stateOf({ pending, visits: { n: 1 } });
	}
	switch (row.situation) {
		case "stop-requested":
			controller.abort();
			break;
		case "stop-after-step":
			await h.log.append({
				type: "StopAfterStepRequested",
				runId: h.runId,
				payload: {},
			});
			break;
		case "past-stop-time":
			state = { ...state, stopAt: Date.now() - 1 };
			break;
		case "step-cap":
			ctx = { ...h.ctx, policy: () => ({ ...h.ctx.policy(), maxSteps: 0 }) };
			break;
		case "time-budget":
			ctx = { ...h.ctx, minuteMs: SHORT_MINUTE };
			break;
		case "none":
			break;
	}
	const before = (await h.events()).length;

	const body = async (
		step: StepHandle,
		entry: ResumePoint,
	): Promise<BodyResult> => {
		seen.push(entry);
		step.record(null, { type: "command-start", command: "fake" });
		switch (row.body) {
			case "ends":
				return {
					kind: "end",
					outcome: "pass",
					outputs: { visit: step.visit, note: "done" },
					error: null,
				};
			case "aborts-mid-body":
				controller.abort();
				expect(step.signal.aborted).toBe(true);
				return { kind: "aborted", outputs: { visit: step.visit } };
			case "stop-requested-ends":
				// The run was stopped before the body: it sees the aborted signal.
				expect(step.signal.aborted).toBe(true);
				return { kind: "aborted", outputs: { visit: step.visit } };
			case "runs-until-aborted":
				// A body that works until its signal fires (the time budget).
				await new Promise<void>((resolve) =>
					step.signal.addEventListener("abort", () => resolve(), {
						once: true,
					}),
				);
				return { kind: "aborted", outputs: { visit: step.visit } };
			case "throws":
				throw new Error("boom");
			case "requests-wait":
				return {
					kind: "wait",
					reason: "usage-limit",
					message: "limit",
					resetAt: null,
					harnessSessionId: null,
				};
		}
	};
	const result = await runStep(ctx, NODE, state, config, {
		rules: RESUME_RULES.model,
		outputs: (step) => ({ visit: step.visit, note: "" }),
		body,
	});
	const events = await h.events();
	return {
		h,
		result,
		appended: events.slice(before).map((e) => e.type),
		events,
		seen,
	};
}

const rows: Row[] = [
	// A new visit: the entry checks run before the step, in this order.
	{
		entry: "new",
		situation: "stop-requested",
		body: "ends",
		appends: [],
		goto: "park__n",
		ran: false,
		pending: { kind: "parked", stepId: null, status: "stopped", reason: null },
	},
	{
		entry: "new",
		situation: "stop-after-step",
		body: "ends",
		appends: [],
		goto: "park__n",
		ran: false,
		pending: {
			kind: "parked",
			stepId: null,
			status: "stopped",
			reason: STOP_AFTER_STEP_REASON,
		},
	},
	{
		entry: "new",
		situation: "past-stop-time",
		body: "ends",
		appends: [],
		goto: "park__n",
		ran: false,
		pending: {
			kind: "parked",
			stepId: null,
			status: "stopped",
			reason: STOP_TIME_REASON,
			atStopTime: true,
		},
	},
	{
		entry: "new",
		situation: "step-cap",
		body: "ends",
		appends: [],
		goto: "park__n",
		ran: false,
		pending: {
			kind: "parked",
			stepId: null,
			status: "failed",
			reason:
				'The run reached the limit of 0 steps before node "n". Resume it to continue.',
		},
	},
	// A new visit: what the body does decides the end.
	{
		entry: "new",
		situation: "none",
		body: "ends",
		appends: ["StepStarted", "StepEnded", "EdgeTaken"],
		goto: "after",
		ran: true,
	},
	{
		entry: "new",
		situation: "none",
		body: "aborts-mid-body",
		appends: ["StepStarted", "StepEnded"],
		goto: "park__n",
		ran: true,
		pending: { kind: "parked", status: "stopped", reason: null },
	},
	{
		entry: "new",
		situation: "none",
		body: "throws",
		appends: ["StepStarted", "StepEnded"],
		goto: "park__n",
		ran: true,
		pending: {
			kind: "parked",
			status: "failed",
			reason: 'Node "n" failed: boom',
		},
	},
	{
		entry: "new",
		situation: "none",
		body: "requests-wait",
		appends: ["StepStarted", "WaitStarted"],
		goto: "wait__n",
		ran: true,
		pending: { kind: "wait", nodeId: "n", reason: "usage-limit", visit: 1 },
	},
	// The node's time budget: the step timer aborts the body, and the step
	// ends `error` with why, for a new and a continued step alike.
	{
		entry: "new",
		situation: "time-budget",
		body: "runs-until-aborted",
		appends: ["StepStarted", "StepEnded"],
		goto: "park__n",
		ran: true,
		pending: {
			kind: "parked",
			status: "failed",
			reason: 'Node "n" failed: The step ran past its time budget of 1 min.',
		},
	},
	{
		entry: "continued",
		situation: "time-budget",
		body: "runs-until-aborted",
		appends: ["StepEnded"],
		goto: "park__n",
		ran: true,
		pending: {
			kind: "parked",
			status: "failed",
			reason: 'Node "n" failed: The step ran past its time budget of 1 min.',
			visit: 1,
		},
	},
	// A continued step: no entry check parks before it, and nothing is
	// appended before the body; only the stop time ends it at entry.
	{
		entry: "continued",
		situation: "stop-requested",
		body: "stop-requested-ends",
		appends: ["StepEnded"],
		goto: "park__n",
		ran: true,
		pending: { kind: "parked", status: "stopped", reason: null, visit: 1 },
	},
	{
		entry: "continued",
		situation: "stop-after-step",
		body: "ends",
		appends: ["StepEnded", "EdgeTaken"],
		goto: "after",
		ran: true,
	},
	{
		entry: "continued",
		situation: "past-stop-time",
		body: "ends",
		appends: ["StepEnded"],
		goto: "park__n",
		ran: false,
		pending: {
			kind: "parked",
			status: "stopped",
			reason: STOP_TIME_REASON,
			atStopTime: true,
			visit: 1,
		},
	},
	{
		entry: "continued",
		situation: "step-cap",
		body: "ends",
		appends: ["StepEnded", "EdgeTaken"],
		goto: "after",
		ran: true,
	},
	{
		entry: "continued",
		situation: "none",
		body: "aborts-mid-body",
		appends: ["StepEnded"],
		goto: "park__n",
		ran: true,
		pending: { kind: "parked", status: "stopped", reason: null, visit: 1 },
	},
	{
		entry: "continued",
		situation: "none",
		body: "throws",
		appends: ["StepEnded"],
		goto: "park__n",
		ran: true,
		pending: { kind: "parked", status: "failed", visit: 1 },
	},
	{
		entry: "continued",
		situation: "none",
		body: "requests-wait",
		appends: ["WaitStarted"],
		goto: "wait__n",
		ran: true,
		pending: { kind: "wait", visit: 1 },
	},
	{
		entry: "continued",
		situation: "none",
		body: "ends",
		appends: ["StepEnded", "EdgeTaken"],
		goto: "after",
		ran: true,
	},
];

describe("the step runner", () => {
	for (const row of rows) {
		test(`${row.entry} entry, ${row.situation}, body ${row.body}: appends ${row.appends.join(", ") || "nothing"} and goes to ${row.goto}`, async () => {
			const { result, appended, events, seen } = await runRow(row);
			expect(appended).toEqual(row.appends);
			expect(result.goto).toEqual([row.goto]);
			expect(seen.length).toBe(row.ran ? 1 : 0);
			if (row.ran) {
				expect(seen[0]?.kind).toBe(row.entry === "new" ? "new" : "continue");
			}
			const update = result.update as { pending?: unknown; visits?: unknown };
			if (row.pending) {
				expect(update.pending).toMatchObject(row.pending);
			} else {
				// Routed on: the step's visit and outputs are in the state, nothing pends.
				expect(update.pending).toBeNull();
				expect(update.visits).toEqual({ n: 1 });
			}
			// One step at most, and the log is consistent with the state.
			const steps = deriveSteps(events);
			expect(steps.length).toBeLessThanOrEqual(1);
			if (row.goto === "wait__n") {
				expect(steps[0]?.endedAt).toBeNull();
			} else if (steps[0] && row.appends.includes("StepEnded")) {
				expect(steps[0].endedAt).not.toBeNull();
			}
		});
	}

	test("the end carries the body's outcome, outputs, error and cost; an abort reads the signal's reason", async () => {
		const ends = await runRow({
			entry: "new",
			situation: "none",
			body: "ends",
			appends: [],
			goto: "",
			ran: true,
		});
		expect(payloads(ends.events, "StepEnded")).toEqual([
			{
				outcome: "pass",
				outputs: { visit: 1, note: "done", outcome: "pass" },
				error: null,
			},
		]);

		const aborted = await runRow({
			entry: "new",
			situation: "none",
			body: "aborts-mid-body",
			appends: [],
			goto: "",
			ran: true,
		});
		expect(payloads(aborted.events, "StepEnded")).toEqual([
			{
				outcome: "stopped",
				outputs: { visit: 1, outcome: "stopped" },
				error: null,
			},
		]);

		const thrown = await runRow({
			entry: "new",
			situation: "none",
			body: "throws",
			appends: [],
			goto: "",
			ran: true,
		});
		// A thrown body ends with the node's empty outputs (`spec.outputs`).
		expect(payloads(thrown.events, "StepEnded")).toEqual([
			{
				outcome: "error",
				outputs: { visit: 1, note: "", outcome: "error" },
				error: "boom",
			},
		]);

		// The time budget: the abort's reason is the node's timer, so the
		// step ends `error` with the budget, keeping the outputs the body had.
		const late = await runRow({
			entry: "new",
			situation: "time-budget",
			body: "runs-until-aborted",
			appends: [],
			goto: "",
			ran: true,
		});
		expect(payloads(late.events, "StepEnded")).toEqual([
			{
				outcome: "error",
				outputs: { visit: 1, outcome: "error" },
				error: "The step ran past its time budget of 1 min.",
			},
		]);
	});

	test("a wait keeps the step open and parks at the wait node; the wake continues it with the same step id", async () => {
		const { h, result, events } = await runRow({
			entry: "continued",
			situation: "none",
			body: "requests-wait",
			appends: [],
			goto: "",
			ran: true,
		});
		const [step] = deriveSteps(events);
		expect(step?.visit).toBe(1);
		expect(step?.endedAt).toBeNull();
		// The second wait of the same step grows the streak.
		const pending = (result as Command).update as { pending: PendingWait };
		expect(pending.pending.stepId).toBe(step?.id as string);
		expect(pending.pending.streak.count).toBe(2);
		expect(payloads(events, "WaitStarted")).toHaveLength(2);
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"WaitStarted",
			"WaitStarted",
		]);
	});
});
