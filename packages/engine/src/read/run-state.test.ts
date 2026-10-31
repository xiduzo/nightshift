import { describe, expect, test } from "bun:test";
import type { FlowNodeType } from "@nightshift/flows";
import {
	type EngineEventType,
	foldRun,
	type LoggedEvent,
	NO_COST,
	type RunStatus,
	type Scope,
	sessionCost,
} from "../log";
import { runEvents as log } from "../testing/run-events";
import { deriveScores } from "./run-metrics";
import { runTrace } from "./run-trace";
import {
	awaitsWorktree,
	countVisits,
	deriveBudgetSpend,
	deriveCalledTraversals,
	deriveNodeOutputs,
	deriveOpenGate,
	deriveRunState,
	deriveSleep,
	deriveSteps,
	deriveTraversals,
	deriveVariables,
	deriveWarnings,
	deriveWorktrees,
	isOpenStatus,
	lastHarnessSession,
	lastHarnessSessionOfNode,
	parkedSteps,
	runWorktree,
	sumCost,
} from "./run-views";

/*
 * The run state (`foldRun`, events in, state out) and the views of it.
 * Every test builds a log, folds it, and reads the state or a view.
 */

describe("deriveRunState", () => {
	test("a run without a start is interrupted", () => {
		expect(deriveRunState(foldRun([]))).toEqual({
			status: "interrupted",
			reason: null,
			result: null,
		});
	});

	test("a started run without an end is running", () => {
		expect(deriveRunState(log().runStarted().state()).status).toBe("running");
	});

	test("the end gives the status and the reason", () => {
		const { events } = log().runStarted().ended("failed", "edge e1 at max");
		expect(deriveRunState(foldRun(events))).toEqual({
			status: "failed",
			reason: "edge e1 at max",
			result: null,
		});
	});

	test("an End node's end gives its result, and its message as the reason", () => {
		const nothing = log()
			.runStarted()
			.ended("finished", "No open issues", "nothing-to-do");
		expect(deriveRunState(foldRun(nothing.events))).toEqual({
			status: "finished",
			reason: "No open issues",
			result: "nothing-to-do",
		});
		const chosen = log().runStarted().ended("failed", null, "failed");
		expect(deriveRunState(foldRun(chosen.events))).toEqual({
			status: "failed",
			reason: null,
			result: "failed",
		});
	});

	test("a resume after an end makes the run running again", () => {
		const b = log().runStarted().ended("stopped").resumed("worker");
		expect(deriveRunState(foldRun(b.events)).status).toBe("running");
		b.ended("finished");
		expect(deriveRunState(foldRun(b.events))).toEqual({
			status: "finished",
			reason: null,
			result: null,
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
		const steps = deriveSteps(foldRun(events));
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
		expect(deriveSteps(foldRun(b.events))[0]?.outcome).toBeNull();
		b.stepEnded("s1", "pass");
		expect(deriveSteps(foldRun(b.events))[0]?.outcome).toBe("pass");
	});

	test("the first end after an opening wins over a late duplicate", () => {
		const { events } = log()
			.stepStarted("s1", "worker")
			.stepEnded("s1", "interrupted")
			.stepEnded("s1", "pass");
		expect(deriveSteps(foldRun(events))[0]?.outcome).toBe("interrupted");
	});
});

test("deriveTraversals counts each edge", () => {
	const { events } = log()
		.edge("e1", "worker", "check")
		.edge("e2", "check", "worker")
		.edge("e1", "worker", "check");
	expect(deriveTraversals(foldRun(events))).toEqual({ e1: 2, e2: 1 });
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
	expect(deriveNodeOutputs(foldRun(events))).toEqual({
		check: { outcome: "pass", log_tail: "second" },
		worker: { outcome: "pass", output: "w" },
	});
});

test("visits per node, and the steps of the current walk", () => {
	const b = log()
		.runStarted()
		.stepStarted("s1", "worker")
		.stepStarted("s2", "check")
		.stepStarted("s3", "worker", 2);
	expect(countVisits(foldRun(b.events), "worker")).toBe(2);
	expect(countVisits(foldRun(b.events), "check")).toBe(1);
	expect(foldRun(b.events).stepsSinceWalk).toBe(3);
	b.ended("stopped").resumed("worker").stepStarted("s4", "worker", 3);
	expect(foldRun(b.events).stepsSinceWalk).toBe(1);
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
	expect(lastHarnessSessionOfNode(foldRun(events), "worker")).toBe("h-1");
	expect(lastHarnessSessionOfNode(foldRun(events), "check")).toBeNull();
	// A session logged before Slice 8 names no harness: it ran on Claude Code.
	expect(lastHarnessSession(foldRun(events))).toEqual({
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
	expect(sumCost(foldRun(events)).usd).toBe(0.75);
});

test("isOpenStatus: a run at work, at a Gate or asleep is open; an ended one is not", () => {
	const statuses: RunStatus[] = [
		"running",
		"waiting",
		"sleeping",
		"finished",
		"failed",
		"stopped",
		"interrupted",
	];
	expect(statuses.filter(isOpenStatus)).toEqual([
		"running",
		"waiting",
		"sleeping",
	]);
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
	const steps = deriveSteps(foldRun(events));
	expect(steps.map((s) => s.cost.usd)).toEqual([0.25, 0.01, 0]);
	expect(sumCost(foldRun(events)).usd).toBeCloseTo(0.26);
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

	const [worker, decide] = deriveSteps(foldRun(events));
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
	expect(sumCost(foldRun(events))).toEqual({
		usd: 0.5,
		estimated: true,
		missing: 2,
		calls: 3,
	});
	expect(deriveWarnings(foldRun(events))).toEqual([
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
		const b = log();
		const push: typeof b.push = (type, payload) =>
			b.push(type, payload, { stepId: "s1", sessionId: "a" });
		const events = b.events;
		push("SessionStarted", { prompt: "go", resumeSessionId: null });
		push("SessionUsage", { ...spent, costUsd: 0.1 });
		push("SessionUsage", spent);
		expect([...foldRun(events).sessions.values()][0]?.spent).toEqual(spent);
		expect(sumCost(foldRun(events)).usd).toBe(0.2);
	});
});

describe("gates", () => {
	test("an open Gate makes the run waiting, and an answer ends the wait", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1", "Ship PR 12?");
		expect(deriveRunState(foldRun(b.events))).toEqual({
			status: "waiting",
			reason: null,
			result: null,
		});
		expect(deriveOpenGate(foldRun(b.events))).toEqual({
			stepId: "s1",
			nodeId: "gate",
			visit: 1,
			question: "Ship PR 12?",
			choices: [{ name: "approve" }, { name: "reject" }],
			lockScreen: false,
			openedAt: b.events.at(-1)?.at ?? 0,
			deadline: null,
		});
		expect(deriveSteps(foldRun(b.events))[0]?.gate?.question).toBe(
			"Ship PR 12?",
		);

		b.stepEnded("s1", "approve", { note: "yes", visit: 1 });
		expect(deriveOpenGate(foldRun(b.events))).toBeNull();
		expect(deriveRunState(foldRun(b.events)).status).toBe("running");
		expect(deriveNodeOutputs(foldRun(b.events)).gate).toEqual({
			outcome: "approve",
			note: "yes",
			visit: 1,
		});
	});

	test("a Gate the author marked for the lock screen says so while it is open", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1", "Ship it?", true);
		expect(deriveOpenGate(foldRun(b.events))?.lockScreen).toBe(true);
		expect(deriveSteps(foldRun(b.events))[0]?.gate?.lockScreen).toBe(true);
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
		const waits = () => deriveSteps(b.state()).flatMap((s) => s.gateWaits);
		expect(waits()).toEqual([
			{ from: at("GateOpened"), to: at("StepEnded"), opening: 0 },
			{ from: at("GateOpened", 1), to: null, opening: 0 },
		]);

		b.ended("stopped");
		expect(waits()[1]?.to).toBe(b.events.at(-1)?.at);
	});

	test("a Gate step that never opened is not waiting", () => {
		const { events } = log().runStarted().stepStarted("s1", "gate");
		expect(deriveOpenGate(foldRun(events))).toBeNull();
		expect(deriveRunState(foldRun(events)).status).toBe("running");
		// Recovery interrupts it like any other open step: it is not parked.
		expect(parkedSteps(foldRun(events))).toEqual([]);
	});

	test("an ended run has no open Gate", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1")
			.ended("failed", "broken log");
		expect(deriveOpenGate(foldRun(events))).toBeNull();
		expect(deriveRunState(foldRun(events)).status).toBe("failed");
	});

	test("a waiting run is not lost work: recovery leaves it open", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.stepEnded("s1", "pass")
			.stepStarted("s2", "gate")
			.gateOpened("s2");
		expect(deriveRunState(foldRun(events)).status).toBe("waiting");
		expect(parkedSteps(foldRun(events)).map((s) => s.id)).toEqual(["s2"]);
	});

	test("a Gate closed by a stop is no longer open", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1")
			.stepEnded("s1", "stopped", { note: "", visit: 1 })
			.ended("stopped");
		expect(deriveOpenGate(foldRun(events))).toBeNull();
		expect(deriveRunState(foldRun(events)).status).toBe("stopped");
	});
});

describe("sleeps", () => {
	const waitStarted = (b: ReturnType<typeof log>, stepId: string) =>
		b.push(
			"WaitStarted",
			{ reason: "command", until: 9999, message: "Tries again", since: 0 },
			{ stepId },
		);
	const waitEnded = (b: ReturnType<typeof log>, stepId: string) =>
		b.push("WaitEnded", { early: false }, { stepId });
	const at = (b: ReturnType<typeof log>, index: number) =>
		b.events[index]?.at ?? 0;

	test("a step keeps each time it slept, and the one it sleeps in stays open", () => {
		const b = log().runStarted().stepStarted("s1", "check");
		waitStarted(b, "s1");
		waitEnded(b, "s1");
		waitStarted(b, "s1");
		expect(deriveSteps(foldRun(b.events))[0]?.sleeps).toEqual([
			{
				from: at(b, 2),
				to: at(b, 3),
				reason: "command",
				signal: null,
				opening: 0,
			},
			{ from: at(b, 4), to: null, reason: "command", signal: null, opening: 0 },
		]);
	});

	test("a wait logged again in the same sleep does not start a new one", () => {
		const b = log().runStarted().stepStarted("s1", "check");
		waitStarted(b, "s1");
		waitStarted(b, "s1");
		expect(deriveSteps(foldRun(b.events))[0]?.sleeps).toEqual([
			{ from: at(b, 2), to: null, reason: "command", signal: null, opening: 0 },
		]);
	});

	test("a sleep ends when the run ends, also with its step still open", () => {
		const b = log().runStarted().stepStarted("s1", "check");
		waitStarted(b, "s1");
		b.ended("stopped");
		expect(deriveSteps(foldRun(b.events))[0]?.sleeps).toEqual([
			{
				from: at(b, 2),
				to: at(b, 3),
				reason: "command",
				signal: null,
				opening: 0,
			},
		]);
	});

	test("a sleep ends when its step ends", () => {
		const b = log().runStarted().stepStarted("s1", "check");
		waitStarted(b, "s1");
		b.stepEnded("s1", "stopped");
		expect(deriveSteps(foldRun(b.events))[0]?.sleeps).toEqual([
			{
				from: at(b, 2),
				to: at(b, 3),
				reason: "command",
				signal: null,
				opening: 0,
			},
		]);
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
		expect(deriveSteps(foldRun(b.events)).map((s) => s.nodeType)).toEqual([
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
		expect(deriveNodeOutputs(foldRun(b.events)).worker?.summary).toBe("top");
		expect(deriveNodeOutputs(foldRun(b.events), key).worker?.summary).toBe(
			"inside",
		);
		expect(countVisits(foldRun(b.events), "worker")).toBe(1);
		expect(countVisits(foldRun(b.events), "worker", key)).toBe(1);
		expect(deriveTraversals(foldRun(b.events))).toEqual({ e1: 1 });
		expect(deriveTraversals(foldRun(b.events), key)).toEqual({ e1: 1 });
		expect(lastHarnessSessionOfNode(foldRun(b.events), "worker", key)).toBe(
			"h-1",
		);
		expect(lastHarnessSessionOfNode(foldRun(b.events), "worker")).toBeNull();
	});

	test("each called flow's edge counts come per scope, the top level apart", () => {
		const b = nested();
		const taken = (edgeId: string, itemId: string) =>
			b.push("EdgeTaken", {
				edgeId,
				from: "worker",
				to: "check",
				outcome: "pass",
				scope: { parentStepId: "inner", itemId },
			});
		taken("e1", "a1");
		taken("e2", "a2");
		taken("e1", "a1");
		b.edge("e9", "worker", "check");
		expect(deriveCalledTraversals(foldRun(b.events))).toEqual([
			{ scope: { parentStepId: "inner", itemId: "a1" }, traversals: { e1: 2 } },
			{ scope: { parentStepId: "inner", itemId: "a2" }, traversals: { e2: 1 } },
		]);
		expect(deriveTraversals(foldRun(b.events))).toEqual({ e9: 1 });
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
		const outer = () =>
			deriveSteps(foldRun(b.events)).find((s) => s.id === "outer");
		expect(outer()?.items[0]).toMatchObject({ state: "running", open: true });
		const inner = deriveSteps(foldRun(b.events)).find((s) => s.id === "inner");
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
		expect(deriveRunState(foldRun(b.events)).status).toBe("sleeping");
		expect(deriveSleep(foldRun(b.events))).toMatchObject({
			stepId: "w",
			until: 5000,
		});
		expect(parkedSteps(foldRun(b.events)).map((s) => s.id)).toEqual([
			"w",
			"inner",
			"outer",
		]);

		b.push("WaitEnded", { early: false }, { stepId: "w" });
		expect(deriveRunState(foldRun(b.events)).status).toBe("running");
		expect(parkedSteps(foldRun(b.events))).toEqual([]);
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
		expect(foldRun(b.events).stopAt).toBe(99);
		expect(foldRun(b.events).stopAfterStep).toBe(false);
		b.push("StopAfterStepRequested", {});
		expect(foldRun(b.events).stopAfterStep).toBe(true);
		b.push("StopAfterStepCancelled", {});
		expect(foldRun(b.events).stopAfterStep).toBe(false);
		b.push("StopAfterStepRequested", {});
		expect(foldRun(b.events).stopAfterStep).toBe(true);
		b.ended("stopped");
		b.push("RunResumed", {
			nodeId: "worker",
			stepId: null,
			prompt: null,
			clearStopAt: true,
		});
		expect(foldRun(b.events).stopAfterStep).toBe(false);
		expect(foldRun(b.events).stopAt).toBeNull();
	});
});

describe("automatic resume", () => {
	test("the state counts the daemon's resumes since the start or a person's resume", () => {
		const l = log().runStarted();
		const daemon = () =>
			l.push("RunResumed", {
				nodeId: "worker",
				stepId: null,
				prompt: null,
				by: "daemon",
			});
		expect(foldRun(l.events).daemonResumes).toBe(0);
		daemon();
		daemon();
		expect(foldRun(l.events).daemonResumes).toBe(2);
		// A person's resume (no `by` in older logs) starts over.
		l.resumed("worker");
		expect(foldRun(l.events).daemonResumes).toBe(0);
		daemon();
		expect(foldRun(l.events).daemonResumes).toBe(1);
	});
});

describe("the run budget", () => {
	test("the budget counts sessions and deciders since the start or a person's resume, not the daemon's", () => {
		const l = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.sessionStarted("s1", "a")
			.sessionEnded("s1", "a", "finished", 1.5)
			.stepEnded("s1", "pass")
			.stepStarted("s2", "decide")
			.stepEnded("s2", "pass", {}, 0.25);
		expect(deriveBudgetSpend(foldRun(l.events)).usd).toBeCloseTo(1.75, 9);
		// After a restart the daemon resumed the run: the spend stays.
		l.push("RunResumed", {
			nodeId: "worker",
			stepId: null,
			prompt: null,
			by: "daemon",
		});
		expect(deriveBudgetSpend(foldRun(l.events)).usd).toBeCloseTo(1.75, 9);
		// A person resumed it: a budget of its own again.
		l.resumed("worker");
		expect(deriveBudgetSpend(foldRun(l.events)).usd).toBe(0);
		l.stepStarted("s3", "worker", 2)
			.sessionStarted("s3", "b")
			.push(
				"SessionUsage",
				{ usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.5 },
				{ stepId: "s3", sessionId: "b" },
			);
		// A running session counts with its spend so far.
		expect(deriveBudgetSpend(foldRun(l.events)).usd).toBe(0.5);
	});
});

describe("the run's worktree", () => {
	const made = {
		worktreePath: "/b/worktrees/abcd1234",
		branch: "nightshift/abcd1234",
		baseRef: "c0ffee",
	};
	/** A row written while the run's Device was offline: no worktree, the base the person asked for. */
	const waiting = { worktreePath: "", branch: "", baseRef: "main" };
	const run = { deviceId: "device-b", walkerId: "host" };

	test("a run whose Device was offline at the start has none until the event names it", () => {
		const events = log().runStarted().events;
		expect(foldRun(events).worktree).toBeNull();
		expect(awaitsWorktree(waiting, foldRun(events))).toBe(true);
		expect(runWorktree(waiting, foldRun(events))).toEqual(waiting);
		expect(
			deriveWorktrees(foldRun(events), { ...run, ...waiting }).paths,
		).toEqual(new Map());
	});

	test("the worktree a later step made comes from the event, on every Replica", () => {
		const events = log().runStarted().push("WorktreeCreated", made).events;
		expect(awaitsWorktree(waiting, foldRun(events))).toBe(false);
		expect(runWorktree(waiting, foldRun(events))).toEqual(made);
		expect(deriveWorktrees(foldRun(events), { ...run, ...waiting })).toEqual({
			holder: "device-b",
			paths: new Map([["device-b", made.worktreePath]]),
		});
	});

	test("an old run without the event reads its worktree from its row", () => {
		const events = log().runStarted().events;
		expect(awaitsWorktree(made, foldRun(events))).toBe(false);
		expect(runWorktree(made, foldRun(events))).toEqual(made);
		expect(deriveWorktrees(foldRun(events), { ...run, ...made }).paths).toEqual(
			new Map([["device-b", made.worktreePath]]),
		);
	});

	test("a Hand-off moves the work on from the worktree the event named", () => {
		const events = log().runStarted().push("WorktreeCreated", made).push(
			"HandedOff",
			{
				from: "device-b",
				to: "device-c",
				commit: "beef",
				branch: made.branch,
				worktreePath: "/c/worktrees/abcd1234",
			},
			{ stepId: "s1" },
		).events;
		expect(deriveWorktrees(foldRun(events), { ...run, ...waiting })).toEqual({
			holder: "device-c",
			paths: new Map([
				["device-b", made.worktreePath],
				["device-c", "/c/worktrees/abcd1234"],
			]),
		});
	});
});

describe("one place decides when a step ends", () => {
	test("a second StepStarted of a step is a new opening that keeps the first one's end", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.stepEnded("s1", "fail", {}, 0.5)
			.stepStarted("s1", "worker", 1)
			.stepEnded("s1", "pass", {}, 0.25);
		const run = b.state();
		const [step] = deriveSteps(run);
		expect(deriveSteps(run)).toHaveLength(1);
		expect(step?.openings.map((o) => [o.kind, o.end?.payload.outcome])).toEqual(
			[
				["start", "fail"],
				["start", "pass"],
			],
		);
		// The latest opening is the current one.
		expect(step?.outcome).toBe("pass");
		expect(step?.startedAt).toBe(b.events[3]?.at);
		// Each end counts once, in the step's cost, the budget and the trace.
		expect(step?.cost.usd).toBe(0.75);
		expect(deriveBudgetSpend(run).usd).toBe(0.75);
		expect(runTrace(run)?.steps[0]?.ends.map((e) => [e.seq, e.first])).toEqual([
			[3, true],
			[5, false],
		]);
		// A new opening is not a new visit.
		expect(countVisits(run, "worker")).toBe(1);
	});

	test("a late duplicate end counts nowhere: not in cost, budget, outputs or variables", () => {
		const b = log().runStarted().stepStarted("s1", "decide");
		b.push(
			"StepEnded",
			{
				outcome: "pass",
				outputs: { outcome: "pass" },
				error: null,
				costUsd: 0.1,
				variables: { n: 1 },
			},
			{ stepId: "s1" },
		);
		b.push(
			"StepEnded",
			{
				outcome: "fail",
				outputs: { outcome: "fail" },
				error: null,
				costUsd: 5,
				variables: { n: 2 },
			},
			{ stepId: "s1" },
		);
		const run = b.state();
		expect(deriveSteps(run)[0]?.cost.usd).toBe(0.1);
		expect(deriveBudgetSpend(run).usd).toBe(0.1);
		expect(sumCost(run).usd).toBe(0.1);
		expect(deriveNodeOutputs(run).decide).toEqual({ outcome: "pass" });
		expect(deriveVariables(run)).toEqual({ n: 1 });
		expect(run.variableChanges.map((c) => c.value)).toEqual([1]);
		expect(runTrace(run)?.steps[0]?.ends).toHaveLength(1);
	});

	test("a reopened step that ends again counts each end, once per opening", () => {
		const run = log()
			.runStarted()
			.stepStarted("s1", "decide")
			.stepEnded("s1", "pass", {}, 0.1)
			.stepReopened("s1")
			.stepEnded("s1", "pass", {}, 0.2)
			.state();
		expect(deriveSteps(run)[0]?.cost.usd).toBeCloseTo(0.3);
		expect(deriveBudgetSpend(run).usd).toBeCloseTo(0.3);
		expect(runTrace(run)?.steps[0]?.ends.map((e) => e.costUsd)).toEqual([
			0.1, 0.2,
		]);
	});

	test("a GateOpened again while the Gate waits opens no second wait", () => {
		const b = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1")
			.gateOpened("s1");
		expect(deriveSteps(b.state())[0]?.gateWaits).toEqual([
			{ from: 1002, to: null, opening: 0 },
		]);
		b.stepEnded("s1", "approve");
		expect(deriveSteps(b.state())[0]?.gateWaits).toEqual([
			{ from: 1002, to: 1004, opening: 0 },
		]);
		expect(runTrace(b.state())?.steps[0]?.ends[0]?.gateWaits).toHaveLength(1);
	});

	test("a sleep keeps what it waits for", () => {
		const run = log()
			.runStarted()
			.stepStarted("s1", "wait")
			.waitStarted("s1", { reason: "signal", until: null, signal: "deploy" })
			.state();
		expect(deriveSteps(run)[0]?.sleeps).toEqual([
			{ from: 1002, to: null, reason: "signal", signal: "deploy", opening: 0 },
		]);
		expect(deriveSleep(run)).toMatchObject({ signal: "deploy", until: null });
	});

	test("the scores are kept in log order", () => {
		const b = log().runStarted().stepStarted("s1", "gate");
		b.push(
			"Scored",
			{ score: "gate_decision", value: 1, label: "approve", by: "person" },
			{ stepId: "s1" },
		);
		expect(deriveScores(b.state())).toEqual([
			{
				score: "gate_decision",
				value: 1,
				label: "approve",
				stepId: "s1",
				at: 1002,
			},
		]);
	});

	test("events out of seq order fold as in seq order", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.stepEnded("s1", "pass");
		const shuffled: LoggedEvent[] = [events[2], events[0], events[1]].flatMap(
			(e) => (e ? [e] : []),
		);
		expect(foldRun(shuffled)).toEqual(foldRun(events));
	});
});
