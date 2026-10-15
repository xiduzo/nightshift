import { describe, expect, test } from "bun:test";

import {
	countStepsSinceWalkBegan,
	countVisits,
	deriveNodeOutputs,
	deriveOpenGate,
	deriveResumePoint,
	deriveRunState,
	deriveSteps,
	deriveTraversals,
	type EngineEventType,
	type EnginePayloads,
	type LoggedEvent,
	lastHarnessSession,
	lastHarnessSessionOfNode,
	openWork,
	type SessionOutcome,
	sumCostUsd,
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
							: nodeId === "gate"
								? "gate"
								: nodeId === "decide"
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
		expect(steps[0]?.costUsd).toBe(0.25);
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
	expect(lastHarnessSession(events)).toBe("h-2");
});

describe("deriveResumePoint", () => {
	test("an agent step with a harness session continues that session", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "worker")
			.sessionStarted("s1", "a")
			.harness("s1", "a", "h-1")
			.sessionEnded("s1", "a", "stopped")
			.stepEnded("s1", "stopped")
			.ended("stopped");
		expect(deriveResumePoint(events)).toEqual({
			kind: "session",
			stepId: "s1",
			nodeId: "worker",
			harnessSessionId: "h-1",
		});
	});

	test("a command step runs its node again", () => {
		const { events } = log()
			.stepStarted("s1", "check")
			.stepEnded("s1", "fail")
			.ended("failed");
		expect(deriveResumePoint(events)).toEqual({
			kind: "node",
			nodeId: "check",
		});
	});

	test("an edge taken after the last step continues at its target", () => {
		const { events } = log()
			.stepStarted("s1", "check")
			.stepEnded("s1", "fail")
			.edge("e2", "check", "worker")
			.ended("stopped");
		expect(deriveResumePoint(events)).toEqual({
			kind: "node",
			nodeId: "worker",
		});
	});

	test("a run without steps has no resume point", () => {
		expect(deriveResumePoint(log().runStarted().events)).toBeNull();
	});
});

test("sumCostUsd adds the cost of each ended session once", () => {
	const { events } = log()
		.sessionStarted("s1", "a")
		.sessionEnded("s1", "a", "finished", 0.25)
		.sessionStarted("s1", "b")
		.sessionEnded("s1", "b", "failed")
		.sessionStarted("s2", "c")
		.sessionEnded("s2", "c", "finished", 0.5)
		.sessionEnded("s2", "c", "finished", 9);
	expect(sumCostUsd(events)).toBe(0.75);
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

test("sumCostUsd and step costs include what a step spent itself", () => {
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
	expect(steps.map((s) => s.costUsd)).toEqual([0.25, 0.01, 0]);
	expect(sumCostUsd(events)).toBeCloseTo(0.26);
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

	test("a Gate closed by a stop resumes as a new visit of the Gate", () => {
		const { events } = log()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1")
			.stepEnded("s1", "stopped", { note: "", visit: 1 })
			.ended("stopped");
		expect(deriveOpenGate(events)).toBeNull();
		expect(deriveRunState(events).status).toBe("stopped");
		expect(deriveResumePoint(events)).toEqual({ kind: "node", nodeId: "gate" });
	});
});
