import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import type { AgentSessionInput } from "@nightshift/agents";
import {
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/fake";

import { createSandbox, type Sandbox } from "../test-support";
import { STOP_TIME_REASON } from "./context";
import {
	agent,
	command,
	drive,
	edge,
	flowOf,
	startRun,
} from "./node-test-support";
import type { PendingWait } from "./state";

/**
 * The facts the walk reads from its own state rather than the log: the
 * run's stop time (`stopAt`, set by the start input and cleared by a
 * resume's `Command` update) and a waiting step's streak
 * (`pending.streak`).
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const subflow = (id: string, flow: string) =>
	({
		id,
		type: "subflow",
		position: { x: 0, y: 0 },
		flow,
		inputs: {},
	}) as const;

describe("the stop time in the state", () => {
	test("the start input sets it, the next step parks on it, and a resume's update clears it", async () => {
		let clock = Date.now();
		const stopAt = clock + 60_000;
		// The agent's session takes the run past its stop time.
		const harness = fakeHarness(() => {
			clock = stopAt + 1;
			return reportingScript("pass");
		});
		const h = await startRun(
			sandbox,
			flowOf(
				[agent("worker", "Go"), command("check", "true")],
				[edge("e1", "worker", "pass", "check")],
			),
			harness,
		);
		h.ctx.now = () => clock;

		const first = await drive(h, { inputs: {}, stopAt });
		expect(first.state.stopAt).toBe(stopAt);
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId: null,
				nodeId: "check",
				status: "stopped",
				reason: STOP_TIME_REASON,
			},
		]);

		// The engine clears the stop time with the resume (`RunResumed.clearStopAt`).
		const second = await drive(
			h,
			new Command({
				resume: { kind: "resume" },
				update: { stopAt: null },
			}),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.stopAt).toBeNull();
		expect(second.state.ended?.status).toBe("finished");
		expect(second.state.visits).toEqual({ worker: 1, check: 1 });
	});

	test("a stop time cleared at the root reaches a body that resumes from its own checkpoint", async () => {
		let clock = Date.now();
		const stopAt = clock + 60_000;
		const harness = fakeHarness(() => {
			clock = stopAt + 1;
			return reportingScript("pass");
		});
		const body = flowOf(
			[agent("work", "Go"), command("check", "true")],
			[edge("b1", "work", "pass", "check")],
		);
		const h = await startRun(
			sandbox,
			flowOf([subflow("sub", "body")]),
			harness,
			{ flows: { body } },
		);
		h.ctx.now = () => clock;

		const first = await drive(h, { inputs: {}, stopAt });
		// The body's second step parked on the stop time; the Subflow step
		// ended `stopped` and the run parked inside the body.
		expect(first.parked[0]).toMatchObject({
			kind: "parked",
			nodeId: "check",
			status: "stopped",
			reason: STOP_TIME_REASON,
		});

		const second = await drive(
			h,
			new Command({
				resume: { kind: "resume" },
				update: { stopAt: null },
			}),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.status).toBe("finished");
		expect(second.state.nodes.sub).toMatchObject({ outcome: "pass" });
		expect(harness.calls).toHaveLength(1);
	});

	test("a Command update reaches a thread pending at a node before the node re-runs", async () => {
		let clock = Date.now();
		const stopAt = clock + 60_000;
		const harness = fakeHarness(reportingScript("pass"));
		const h = await startRun(sandbox, flowOf([agent("worker", "Go")]), harness);
		h.ctx.now = () => clock;

		// The daemon dies as the step opens: the thread is pending at the
		// node, the log has the step, and the checkpoint has the stop time.
		const recorder = h.ctx.recorder;
		h.ctx.recorder = async () => {
			throw new Error("the daemon died");
		};
		await expect(drive(h, { inputs: {}, stopAt })).rejects.toThrow(
			"the daemon died",
		);
		h.ctx.recorder = recorder;
		const dead = await h.graph().getState(h.config);
		expect(dead.next).toEqual(["worker"]);
		expect(dead.values.stopAt).toBe(stopAt);

		// Past the stop time, a person resumes: the engine clears it in the
		// state and re-runs the node.
		clock = stopAt + 1;
		const third = await drive(
			h,
			new Command({ update: { stopAt: null } }),
			h.graph(),
		);
		expect(third.parked).toEqual([]);
		expect(third.state.stopAt).toBeNull();
		expect(third.state.ended?.status).toBe("finished");
		expect(harness.calls).toHaveLength(1);
	});
});

describe("a waiting step's streak", () => {
	test("the waits grow from the first one's start: 5, 10, 20 min", async () => {
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call < 3 ? usageLimitScript() : reportingScript("pass"),
		);
		const h = await startRun(sandbox, flowOf([agent("worker", "Go")]), harness);
		const waits: PendingWait[] = [];
		let driven = await drive(h, { inputs: {} });
		for (let i = 0; i < 3; i++) {
			expect(driven.parked[0]).toMatchObject({ kind: "wait" });
			const pending = driven.state.pending as PendingWait;
			waits.push(pending);
			await h.log.append({
				type: "WaitEnded",
				runId: h.runId,
				stepId: pending.stepId,
				payload: { early: false },
			});
			driven = await drive(
				h,
				new Command({ resume: { kind: "wake", early: false } }),
				h.graph(),
			);
		}
		expect(driven.state.ended?.status).toBe("finished");
		expect(waits.map((w) => w.streak)).toEqual([
			{ count: 1, since: expect.any(Number) },
			{ count: 2, since: waits[0]?.streak.since as number },
			{ count: 3, since: waits[0]?.streak.since as number },
		]);
		expect(waits.map((w) => w.message)).toEqual([
			"Usage limit: You've hit your limit. The step continues in 5 min.",
			"Usage limit: You've hit your limit. The step continues in 10 min.",
			"Usage limit: You've hit your limit. The step continues in 20 min.",
		]);
		expect(harness.calls).toHaveLength(4);
	});
});
