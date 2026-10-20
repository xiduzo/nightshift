import { describe, expect, test } from "bun:test";
import type { FlowNodeType } from "@nightshift/flows";

import {
	countDaemonResumes,
	countStepsSinceWalkBegan,
	countVisits,
	deriveGateWaits,
	deriveNodeOutputs,
	deriveOpenGate,
	deriveRunState,
	deriveSessions,
	deriveSleep,
	deriveSteps,
	deriveStopAfterStep,
	deriveStopAt,
	deriveTraversals,
	deriveWarnings,
	type EngineEventType,
	type EnginePayloads,
	type LoggedEvent,
	lastHarnessSession,
	lastHarnessSessionOfNode,
	NO_COST,
	openWork,
	type Scope,
	type SessionOutcome,
	sessionCost,
	sumCost,
} from "./events";
import type { StepOutcome } from "./types";

/** Builds a log for one run. Each helper appends one event with the next seq. */
function log() {
	const events: LoggedEvent[] = [];
	const push = <T extends EngineEventType>(
		type: T,
		payload: EnginePayloads[T],
		ids: { stepId?: string; sessionId?: string } = {},
	) => {
		events.push({
			seq: events.length + 1,
			runId: "run-1",
			stepId: ids.stepId ?? null,
			sessionId: ids.sessionId ?? null,
			type,
			payload,
			at: 1000 + events.length,
		} as LoggedEvent);
		return builder;
	};
	const builder = {
		events,
		push,
		runStarted: () =>
			push("RunStarted", {
				projectId: "p",
				flowName: "f",
				title: "f",
				start: "worker",
			}),
		resumed: (nodeId: string, stepId: string | null = null) =>
			push("RunResumed", { nodeId, stepId, prompt: null }),
		stepStarted: (stepId: string, nodeId: string, visit = 1) =>
			push(
				"StepStarted",
				{
					nodeId,
					nodeType:
						nodeId === "check"
							? "command"
							: nodeId === "gate" || nodeId === "decide"
								? "decision"
								: "agent",
					visit,
					transcriptPath: `/t/${stepId}`,
					logPath: null,
				},
				{ stepId },
			),
		stepReopened: (stepId: string) =>
			push("StepReopened", { prompt: "go on" }, { stepId }),
		stepEnded: (
			stepId: string,
			outcome: StepOutcome,
			outputs: Record<string, string | number> = {},
			costUsd?: number | null,
		) =>
			push(
				"StepEnded",
				{
					outcome,
					outputs: { outcome, ...outputs },
					error: null,
					...(costUsd === undefined ? {} : { costUsd }),
				},
				{ stepId },
			),
		gateOpened: (stepId: string, question = "Ship it?") =>
			push(
				"GateOpened",
				{ question, choices: [{ name: "approve" }, { name: "reject" }] },
				{ stepId },
			),
		sessionStarted: (stepId: string, sessionId: string) =>
			push(
				"SessionStarted",
				{ prompt: "p", resumeSessionId: null },
				{ stepId, sessionId },
			),
		harness: (stepId: string, sessionId: string, harnessSessionId: string) =>
			push(
				"HarnessSessionAssigned",
				{ harnessSessionId, model: null },
				{ stepId, sessionId },
			),
		sessionEnded: (
			stepId: string,
			sessionId: string,
			outcome: SessionOutcome,
			costUsd: number | null = null,
		) =>
			push(
				"SessionEnded",
				{
					outcome,
					error: null,
					errorKind: null,
					usage: null,
					costUsd,
					resetAt: null,
				},
				{ stepId, sessionId },
			),
		edge: (edgeId: string, from: string, to: string) =>
			push("EdgeTaken", { edgeId, from, to, outcome: "fail" }),
		ended: (
			status: EnginePayloads["RunEnded"]["status"],
			reason: string | null = null,
		) => push("RunEnded", { status, reason }),
	};
	return builder;
}

describe("deriveRunState", () => {
	test("a run without a start is interrupted", () => {
		expect(deriveRunState([])).toEqual({ status: "interrupted", reason: null });
	});

	test("a started run without an end is running", () => {
		expect(deriveRunState(log().runStarted().events).status).toBe("running");
	});

	test("the end gives the status and the reason", () => {
		const { events } = log().runStarted().ended("failed", "edge e1 at max");
		expect(deriveRunState(events)).toEqual({
			status: "failed",
			reason: "edge e1 at max",
		});
	});

	test("a resume after an end makes the run running again", () => {
		const b = log().runStarted().ended("stopped").resumed("worker");
		expect(deriveRunState(b.events).status).toBe("running");
		b.ended("finished");
		expect(deriveRunState(b.events)).toEqual({
			status: "finished",
			reason: null,
		});
	});
});

describe("deriveSteps", () => {
	test("steps carry their outcome, outputs and sessions in start order", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.sessionStarted("s1", "a")
			.harness("s1", "a", "h-1")
			.sessionEnded("s1", "a", "finished", 0.25)
			.stepEnded("s1", "pass", { output: "done", visit: 1 })
			.stepStarted("s2", "check")
			.stepEnded("s2", "fail", { exit_code: 1, visit: 1 })
			.stepStarted("s3", "worker", 2);
		const steps = deriveSteps(events);
		expect(steps.map((s) => [s.id, s.nodeId, s.visit, s.outcome])).toEqual([
			["s1", "worker", 1, "pass"],
			["s2", "check", 1, "fail"],
			["s3", "worker", 2, null],
		]);
		expect(steps[0]?.outputs).toEqual({
			outcome: "pass",
			output: "done",
			visit: 1,
		});
		expect(steps[0]?.sessions.map((s) => s.harnessSessionId)).toEqual(["h-1"]);
		expect(steps[0]?.cost.usd).toBe(0.25);
		expect(steps[2]?.endedAt).toBeNull();
	});

	test("a reopened step is open until it ends again", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.stepEnded("s1", "stopped")
			.stepReopened("s1");
		expect(deriveSteps(b.events)[0]?.outcome).toBeNull();
		b.stepEnded("s1", "pass");
		expect(deriveSteps(b.events)[0]?.outcome).toBe("pass");
	});

	test("the first end after an opening wins over a late duplicate", () => {
		const { events } = log()
			.stepStarted("s1", "worker")
			.stepEnded("s1", "interrupted")
			.stepEnded("s1", "pass");
		expect(deriveSteps(events)[0]?.outcome).toBe("interrupted");
	});
});

test("deriveTraversals counts each edge", () => {
	const { events } = log()
		.edge("e1", "worker", "check")
		.edge("e2", "check", "worker")
		.edge("e1", "worker", "check");
	expect(deriveTraversals(events)).toEqual({ e1: 2, e2: 1 });
});

test("deriveNodeOutputs keeps the latest ended visit per node", () => {
	const { events } = log()
		.stepStarted("s1", "check")
		.stepEnded("s1", "fail", { log_tail: "first" })
		.stepStarted("s2", "worker")
		.stepEnded("s2", "pass", { output: "w" })
		.stepStarted("s3", "check", 2)
		.stepEnded("s3", "pass", { log_tail: "second" })
		.stepStarted("s4", "worker", 2);
	expect(deriveNodeOutputs(events)).toEqual({
		check: { outcome: "pass", log_tail: "second" },
		worker: { outcome: "pass", output: "w" },
	});
});

test("countVisits and countStepsSinceWalkBegan", () => {
	const b = log()
		.runStarted()
		.stepStarted("s1", "worker")
		.stepStarted("s2", "check")
		.stepStarted("s3", "worker", 2);
	expect(countVisits(b.events, "worker")).toBe(2);
	expect(countVisits(b.events, "check")).toBe(1);
	expect(countStepsSinceWalkBegan(b.events)).toBe(3);
	b.ended("stopped").resumed("worker").stepStarted("s4", "worker", 3);
	expect(countStepsSinceWalkBegan(b.events)).toBe(1);
});

test("harness session lookups", () => {
	const { events } = log()
		.stepStarted("s1", "worker")
		.sessionStarted("s1", "a")
		.harness("s1", "a", "h-1")
		.sessionEnded("s1", "a", "finished")
		.stepStarted("s2", "reviewer")
		.sessionStarted("s2", "b")
		.harness("s2", "b", "h-2");
	expect(lastHarnessSessionOfNode(events, "worker")).toBe("h-1");
	expect(lastHarnessSessionOfNode(events, "check")).toBeNull();
	// A session logged before Slice 8 names no harness: it ran on Claude Code.
	expect(lastHarnessSession(events)).toEqual({
		harness: "claude-code",
		harnessSessionId: "h-2",
	});
});

test("sumCost adds the cost of each ended session once", () => {
	const { events } = log()
		.sessionStarted("s1", "a")
		.sessionEnded("s1", "a", "finished", 0.25)
		.sessionStarted("s1", "b")
		.sessionEnded("s1", "b", "failed")
		.sessionStarted("s2", "c")
		.sessionEnded("s2", "c", "finished", 0.5)
		.sessionEnded("s2", "c", "finished", 9);
	expect(sumCost(events).usd).toBe(0.75);
});

test("openWork lists what a dead daemon left open", () => {
	const { events } = log()
		.runStarted()
		.stepStarted("s1", "check")
		.stepEnded("s1", "fail")
		.stepStarted("s2", "worker")
		.sessionStarted("s2", "a");
	const open = openWork(events);
	expect(open.sessions.map((s) => s.id)).toEqual(["a"]);
	expect(open.steps.map((s) => s.id)).toEqual(["s2"]);
	expect(open.runOpen).toBe(true);

	const done = log().runStarted().ended("finished");
	expect(openWork(done.events).runOpen).toBe(false);
});

test("sumCost and step costs include what a step spent itself", () => {
	const { events } = log()
		.runStarted()
		.stepStarted("s1", "worker")
		.sessionStarted("s1", "a")
		.sessionEnded("s1", "a", "finished", 0.25)
		.stepEnded("s1", "pass")
		.stepStarted("s2", "decide")
		.stepEnded("s2", "continue", { notes: "ok" }, 0.01)
		.stepStarted("s3", "decide", 2)
		.stepEnded("s3", "error", {}, null)
		// A late duplicate end of s2 does not count twice.
		.stepEnded("s2", "continue", {}, 5);
	const steps = deriveSteps(events);
	expect(steps.map((s) => s.cost.usd)).toEqual([0.25, 0.01, 0]);
	expect(sumCost(events).usd).toBeCloseTo(0.26);
});

test("a cost tally knows what it does not know", () => {
	const { events, push } = log()
		.runStarted()
		.stepStarted("s1", "worker")
		.sessionStarted("s1", "a");
	// A harness that reported a cost, one priced from tokens, one without either.
	push(
		"SessionEnded",
		{
			outcome: "finished",
			error: null,
			errorKind: null,
			usage: { inputTokens: 10, outputTokens: 1 },
			costUsd: 0.5,
			costSource: "estimated",
			resetAt: null,
		},
		{ stepId: "s1", sessionId: "a" },
	);
	push(
		"SessionStarted",
		{ prompt: "go", resumeSessionId: null },
		{
			stepId: "s1",
			sessionId: "b",
		},
	);
	push(
		"SessionEnded",
		{
			outcome: "finished",
			error: null,
			errorKind: null,
			usage: null,
			costUsd: null,
			resetAt: null,
		},
		{ stepId: "s1", sessionId: "b" },
	);
	// A decider that answered without a cost, and one that failed before it asked.
	push(
		"StepEnded",
		{
			outcome: "pass",
			outputs: { outcome: "pass" },
			error: null,
			costUsd: null,
			costSource: null,
		},
		{ stepId: "s1" },
	);
	push(
		"StepStarted",
		{
			nodeId: "decide",
			nodeType: "decision",
			visit: 1,
			transcriptPath: "t",
			logPath: null,
		},
		{ stepId: "s2" },
	);
	push(
		"StepEnded",
		{
			outcome: "error",
			outputs: { outcome: "error" },
			error: "no key",
			costUsd: null,
		},
		{ stepId: "s2" },
	);
	push(
		"RunWarned",
		{ kind: "cost-unknown", message: "Not known." },
		{ stepId: "s1" },
	);

	const [worker, decide] = deriveSteps(events);
	expect(worker?.cost).toEqual({
		usd: 0.5,
		estimated: true,
		missing: 2,
		calls: 3,
	});
	expect(decide?.cost).toEqual({
		usd: 0,
		estimated: false,
		missing: 0,
		calls: 0,
	});
	expect(sumCost(events)).toEqual({
		usd: 0.5,
		estimated: true,
		missing: 2,
		calls: 3,
	});
	expect(deriveWarnings(events)).toEqual([
		{
			stepId: "s1",
			kind: "cost-unknown",
			message: "Not known.",
			at: expect.any(Number),
		},
	]);
});

describe("sessionCost", () => {
	const failed = {
		outcome: "failed" as const,
		error: "boom",
		errorKind: "harness" as const,
		usage: null,
		costUsd: null,
		resetAt: null,
	};
	const spent = {
		usage: { inputTokens: 1000, outputTokens: 100 },
		costUsd: 0.2,
		costSource: "estimated" as const,
	};

	test("a failed session without usage is not a missing cost", () => {
		expect(sessionCost({ ending: failed, spent: null })).toEqual({
			usd: 0,
			estimated: false,
			missing: 0,
			calls: 1,
		});
	});

	test("a running session costs what it spent so far", () => {
		expect(sessionCost({ ending: null, spent })).toEqual({
			usd: 0.2,
			estimated: true,
			missing: 0,
			calls: 1,
		});
		expect(sessionCost({ ending: null, spent: null })).toEqual(NO_COST);
	});

	test("a session that ended without a cost keeps what it spent so far", () => {
		expect(sessionCost({ ending: failed, spent }).usd).toBe(0.2);
		expect(
			sessionCost({
				ending: { ...failed, outcome: "interrupted" },
				spent,
			}).usd,
		).toBe(0.2);
	});

	test("the final cost replaces what it spent so far", () => {
		expect(
			sessionCost({
				ending: {
					...failed,
					outcome: "finished",
					error: null,
					errorKind: null,
					costUsd: 0.25,
					costSource: "reported",
				},
				spent,
			}),
		).toEqual({ usd: 0.25, estimated: false, missing: 0, calls: 1 });
	});

	test("the log keeps the last running total of each session", () => {
		const events: LoggedEvent[] = [];
		let seq = 0;
		const push = <T extends EngineEventType>(
			type: T,
			payload: EnginePayloads[T],
		) =>
			events.push({
				seq: ++seq,
				runId: "r",
				stepId: "s1",
				sessionId: "a",
				type,
				payload,
				at: seq,
			} as LoggedEvent);
		push("SessionStarted", { prompt: "go", resumeSessionId: null });
		push("SessionUsage", { ...spent, costUsd: 0.1 });
		push("SessionUsage", spent);
		expect(deriveSessions(events)[0]?.spent).toEqual(spent);
		expect(sumCost(events).usd).toBe(0.2);
	});
});

describe("gates", () => {
	test("an open Gate makes the run waiting, and an answer ends the wait", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1", "Ship PR 12?");
		expect(deriveRunState(b.events)).toEqual({
			status: "waiting",
			reason: null,
		});
		expect(deriveOpenGate(b.events)).toEqual({
			stepId: "s1",
			nodeId: "gate",
			visit: 1,
			question: "Ship PR 12?",
			choices: [{ name: "approve" }, { name: "reject" }],
			openedAt: b.events.at(-1)?.at ?? 0,
		});
		expect(deriveSteps(b.events)[0]?.gate?.question).toBe("Ship PR 12?");

		b.stepEnded("s1", "approve", { note: "yes", visit: 1 });
		expect(deriveOpenGate(b.events)).toBeNull();
		expect(deriveRunState(b.events).status).toBe("running");
		expect(deriveNodeOutputs(b.events).gate).toEqual({
			outcome: "approve",
			note: "yes",
			visit: 1,
		});
	});

	test("the Gates a run asked stay in its history after the answer", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1")
			.stepEnded("s1", "approve")
			.stepStarted("s2", "gate", 2)
			.gateOpened("s2");
		const at = (type: EngineEventType, index = 0) =>
			b.events.filter((e) => e.type === type)[index]?.at ?? 0;
		expect(deriveGateWaits(b.events)).toEqual([
			{ openedAt: at("GateOpened"), closedAt: at("StepEnded") },
			{ openedAt: at("GateOpened", 1), closedAt: null },
		]);

		b.ended("stopped");
		expect(deriveGateWaits(b.events)[1]?.closedAt).toBe(b.events.at(-1)?.at);
	});

	test("a Gate step that never opened is not waiting", () => {
		const { events } = log().runStarted().stepStarted("s1", "gate");
		expect(deriveOpenGate(events)).toBeNull();
		expect(deriveRunState(events).status).toBe("running");
		// Recovery interrupts it like any other open step.
		expect(openWork(events).steps.map((s) => s.id)).toEqual(["s1"]);
	});

	test("an ended run has no open Gate", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1")
			.ended("failed", "broken log");
		expect(deriveOpenGate(events)).toBeNull();
		expect(deriveRunState(events).status).toBe("failed");
	});

	test("a waiting run is not lost work: recovery leaves it open", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.stepEnded("s1", "pass")
			.stepStarted("s2", "gate")
			.gateOpened("s2");
		const open = openWork(events);
		expect(open.steps).toEqual([]);
		expect(open.sessions).toEqual([]);
		expect(open.runOpen).toBe(false);
	});

	test("a Gate closed by a stop is no longer open", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1")
			.stepEnded("s1", "stopped", { note: "", visit: 1 })
			.ended("stopped");
		expect(deriveOpenGate(events)).toBeNull();
		expect(deriveRunState(events).status).toBe("stopped");
	});
});

describe("node types of runs from before flow version 4", () => {
	test("a Subflow step and a For Each step read as Call steps", () => {
		const b = log().runStarted();
		const started = (stepId: string, nodeId: string, nodeType: string) =>
			b.push(
				"StepStarted",
				{
					nodeId,
					nodeType: nodeType as FlowNodeType,
					visit: 1,
					transcriptPath: `/t/${stepId}`,
					logPath: null,
					scope: null,
				},
				{ stepId },
			);
		started("s1", "sub", "subflow");
		started("s2", "loop", "foreach");
		started("s3", "worker", "agent");
		expect(deriveSteps(b.events).map((s) => s.nodeType)).toEqual([
			"call",
			"call",
			"agent",
		]);
	});
});

describe("Call scopes", () => {
	const item = (id: string) => ({
		id,
		title: id,
		url: null,
		value: { id, title: id },
	});
	const started = (
		b: ReturnType<typeof log>,
		stepId: string,
		nodeId: string,
		nodeType: "agent" | "call" | "command",
		scope: Scope | null,
	) =>
		b.push(
			"StepStarted",
			{
				nodeId,
				nodeType,
				visit: 1,
				transcriptPath: `/t/${stepId}`,
				logPath: null,
				scope,
			},
			{ stepId },
		);
	const itemStarted = (b: ReturnType<typeof log>, stepId: string, id: string) =>
		b.push(
			"ItemStarted",
			{ item: item(id), index: 1, branch: null, baseBranch: null },
			{ stepId },
		);

	/** loop (top) → item A → inner (For Each) → item a1 → worker. */
	function nested() {
		const b = log().runStarted();
		started(b, "outer", "loop", "call", null);
		itemStarted(b, "outer", "A");
		started(b, "inner", "traces", "call", {
			parentStepId: "outer",
			itemId: "A",
		});
		itemStarted(b, "inner", "a1");
		started(b, "w", "worker", "agent", {
			parentStepId: "inner",
			itemId: "a1",
		});
		b.sessionStarted("w", "s").harness("w", "s", "h-1");
		return b;
	}

	test("outputs, visits and edge counts are kept per scope", () => {
		const b = nested();
		b.stepEnded("w", "pass", { summary: "inside" });
		b.push("EdgeTaken", {
			edgeId: "e1",
			from: "worker",
			to: "check",
			outcome: "pass",
			scope: { parentStepId: "inner", itemId: "a1" },
		});
		started(b, "top", "worker", "agent", null);
		b.stepEnded("top", "pass", { summary: "top" });
		b.edge("e1", "worker", "check");
		const key = "inner/a1";
		expect(deriveNodeOutputs(b.events).worker?.summary).toBe("top");
		expect(deriveNodeOutputs(b.events, key).worker?.summary).toBe("inside");
		expect(countVisits(b.events, "worker")).toBe(1);
		expect(countVisits(b.events, "worker", key)).toBe(1);
		expect(deriveTraversals(b.events)).toEqual({ e1: 1 });
		expect(deriveTraversals(b.events, key)).toEqual({ e1: 1 });
		expect(lastHarnessSessionOfNode(b.events, "worker", key)).toBe("h-1");
		expect(lastHarnessSessionOfNode(b.events, "worker")).toBeNull();
	});

	test("items derive their states, blocked ones included", () => {
		const b = nested();
		b.push(
			"ItemBlocked",
			{ item: item("a2"), blocker: "a1", reason: "blocked by #a1" },
			{ stepId: "inner" },
		);
		b.push(
			"ItemEnded",
			{ itemId: "a1", state: "failed", reason: "boom" },
			{
				stepId: "inner",
			},
		);
		const outer = () => deriveSteps(b.events).find((s) => s.id === "outer");
		expect(outer()?.items[0]).toMatchObject({ state: "running", open: true });
		const inner = deriveSteps(b.events).find((s) => s.id === "inner");
		expect(inner?.scope).toEqual({ parentStepId: "outer", itemId: "A" });
		expect(inner?.items.map((i) => [i.facts.id, i.state, i.reason])).toEqual([
			["a1", "failed", "boom"],
			["a2", "blocked", "blocked by #a1"],
		]);
		// The For Each step ends while item A is in progress.
		b.stepEnded("outer", "interrupted");
		expect(outer()?.items[0]).toMatchObject({
			state: "failed",
			reason: "Night Shift stopped during this item.",
			open: true,
		});
		b.stepReopened("outer");
		expect(outer()?.items[0]).toMatchObject({ state: "running", reason: null });
	});

	test("a sleeping step keeps itself and its For Each steps open across a restart", () => {
		const b = nested();
		b.sessionEnded("w", "s", "failed");
		b.push(
			"WaitStarted",
			{ reason: "usage-limit", until: 5000, message: "limit", since: 1 },
			{ stepId: "w" },
		);
		expect(deriveRunState(b.events).status).toBe("sleeping");
		expect(deriveSleep(b.events)).toMatchObject({ stepId: "w", until: 5000 });
		const open = openWork(b.events);
		expect(open.steps).toEqual([]);
		expect(open.runOpen).toBe(false);

		b.push("WaitEnded", { early: false }, { stepId: "w" });
		expect(deriveRunState(b.events).status).toBe("running");
		expect(openWork(b.events).steps.map((s) => s.id)).toEqual([
			"outer",
			"inner",
			"w",
		]);
	});

	test("stop after the step and the stop time", () => {
		const b = log();
		b.push("RunStarted", {
			projectId: "p",
			flowName: "f",
			title: "f",
			start: "worker",
			stopAt: 99,
		});
		expect(deriveStopAt(b.events)).toBe(99);
		expect(deriveStopAfterStep(b.events)).toBe(false);
		b.push("StopAfterStepRequested", {});
		expect(deriveStopAfterStep(b.events)).toBe(true);
		b.push("StopAfterStepCancelled", {});
		expect(deriveStopAfterStep(b.events)).toBe(false);
		b.push("StopAfterStepRequested", {});
		expect(deriveStopAfterStep(b.events)).toBe(true);
		b.ended("stopped");
		b.push("RunResumed", {
			nodeId: "worker",
			stepId: null,
			prompt: null,
			clearStopAt: true,
		});
		expect(deriveStopAfterStep(b.events)).toBe(false);
		expect(deriveStopAt(b.events)).toBeNull();
	});
});

describe("automatic resume", () => {
	test("countDaemonResumes counts the daemon's resumes since the start or a person's resume", () => {
		const l = log().runStarted();
		const daemon = () =>
			l.push("RunResumed", {
				nodeId: "worker",
				stepId: null,
				prompt: null,
				by: "daemon",
			});
		expect(countDaemonResumes(l.events)).toBe(0);
		daemon();
		daemon();
		expect(countDaemonResumes(l.events)).toBe(2);
		// A person's resume (no `by` in older logs) starts over.
		l.resumed("worker");
		expect(countDaemonResumes(l.events)).toBe(0);
		daemon();
		expect(countDaemonResumes(l.events)).toBe(1);
	});
});
