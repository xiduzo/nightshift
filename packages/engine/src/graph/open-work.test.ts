import { describe, expect, test } from "bun:test";
import type { FlowNodeType } from "@nightshift/flows";

import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
	Scope,
} from "../log/events";
import {
	type ClosingEvent,
	type CutShort,
	closingEvents,
	openWork,
	type RunFlows,
} from "./open-work";

/**
 * How cut-short work ends, as a table: each row is a cut and a situation,
 * and asserts every event `closingEvents` gives, in order. The log is built
 * in memory (the module only reads it); the engine tests stop, time out
 * and recover real runs.
 */

/** One run's log. Each helper appends one event with the next seq. */
function log() {
	const events: LoggedEvent[] = [];
	const push = <T extends EngineEventType>(
		type: T,
		payload: EnginePayloads[T],
		ids: { stepId?: string; sessionId?: string } = {},
	) => {
		events.push({
			seq: events.length + 1,
			runId: "run",
			stepId: ids.stepId ?? null,
			sessionId: ids.sessionId ?? null,
			type,
			payload,
			at: 1_000 + events.length,
		} as LoggedEvent);
		return b;
	};
	const b = {
		events,
		started: () =>
			push("RunStarted", {
				projectId: "p",
				flowName: "f",
				title: "f",
				start: "a",
			} as EnginePayloads["RunStarted"]),
		step: (
			stepId: string,
			nodeId: string,
			nodeType: FlowNodeType | "gate",
			scope: Scope | null = null,
		) =>
			push(
				"StepStarted",
				{
					nodeId,
					nodeType: nodeType as FlowNodeType,
					visit: 1,
					transcriptPath: `/t/${stepId}`,
					logPath: null,
					scope,
				},
				{ stepId },
			),
		session: (stepId: string, sessionId: string) =>
			push(
				"SessionStarted",
				{ prompt: "Go", resumeSessionId: null, harness: "claude-code" },
				{ stepId, sessionId },
			),
		item: (stepId: string, id: string, index: number) =>
			push(
				"ItemStarted",
				{
					item: { id, title: id, url: null, value: id },
					index,
					branch: null,
					baseBranch: null,
				},
				{ stepId },
			),
		itemEnded: (stepId: string, itemId: string, state: "done" | "failed") =>
			push("ItemEnded", { itemId, state, reason: null }, { stepId }),
		gate: (stepId: string) =>
			push(
				"GateOpened",
				{ question: "Ship it?", choices: [{ name: "yes" }, { name: "no" }] },
				{ stepId },
			),
		sleep: (stepId: string) =>
			push(
				"WaitStarted",
				{ reason: "duration", until: 9_000, message: "Waits.", since: 1_000 },
				{ stepId },
			),
		ended: (status: "finished" | "stopped") =>
			push("RunEnded", { status, reason: null }),
	};
	return b;
}

/** A flow with every kind a cut treats on its own: an Agent, a Decision, a Call once and a Call with each. */
const FLOWS: RunFlows = {
	flow: {
		version: 2,
		start: "a",
		nodes: [
			{ id: "a", type: "agent", prompt: "work" },
			{ id: "d", type: "decision", by: "person", options: [] },
			{ id: "once", type: "call", flow: "inner" },
			{
				id: "loop",
				type: "call",
				flow: "inner",
				each: { source: { kind: "json", value: "[]" } },
			},
			{ id: "nap", type: "wait", until: { kind: "duration", minutes: 1 } },
		],
		edges: [],
	},
	called: {
		inner: {
			version: 2,
			start: "w",
			nodes: [{ id: "w", type: "agent", prompt: "inner work" }],
			edges: [],
		},
	},
} as unknown as RunFlows;

const STOPPED: CutShort = { kind: "stopped" };

const sessionEnded = (
	stepId: string,
	sessionId: string,
	how: Pick<
		EnginePayloads["SessionEnded"],
		"outcome" | "error" | "errorKind"
	> = {
		outcome: "stopped",
		error: "The session was aborted.",
		errorKind: "aborted",
	},
): ClosingEvent => ({
	type: "SessionEnded",
	stepId,
	sessionId,
	payload: { ...how, usage: null, costUsd: null, resetAt: null },
});
const stepEnded = (
	stepId: string,
	outputs: Record<string, unknown>,
	outcome: "stopped" | "error" | "interrupted" = "stopped",
	error: string | null = null,
): ClosingEvent => ({
	type: "StepEnded",
	stepId,
	payload: { outcome, outputs: { ...outputs, outcome }, error },
});
const runEnded = (
	status: "stopped" | "failed" | "interrupted",
	reason: string | null = null,
): ClosingEvent => ({ type: "RunEnded", payload: { status, reason } });

describe("closingEvents: a stop", () => {
	test("an Agent step with an open session: the session, then the step, then the run", () => {
		const { events } = log()
			.started()
			.step("s1", "a", "agent")
			.session("s1", "x");
		expect(closingEvents(events, STOPPED, FLOWS)).toEqual([
			sessionEnded("s1", "x"),
			stepEnded("s1", { visit: 1 }),
			runEnded("stopped"),
		]);
	});

	test("a step parked at a Gate and a sleeping step end too", () => {
		const gate = log().started().step("g", "d", "decision").gate("g");
		expect(closingEvents(gate.events, STOPPED, FLOWS)).toEqual([
			stepEnded("g", { note: "", visit: 1 }),
			runEnded("stopped"),
		]);
		const nap = log().started().step("n", "nap", "wait").sleep("n");
		expect(closingEvents(nap.events, STOPPED, FLOWS)).toEqual([
			stepEnded("n", { visit: 1 }),
			runEnded("stopped"),
		]);
	});

	test("a Call once ends after the step inside it, with an empty label", () => {
		const { events } = log()
			.started()
			.step("c", "once", "call")
			.step("w", "w", "agent", { parentStepId: "c", itemId: null });
		expect(closingEvents(events, STOPPED, FLOWS)).toEqual([
			stepEnded("w", { visit: 1 }),
			stepEnded("c", { ended: "", visit: 1 }),
			runEnded("stopped"),
		]);
	});

	test("a Call with each counts its items: one done, one failed, one cut short", () => {
		const { events } = log()
			.started()
			.step("c", "loop", "call")
			.item("c", "i1", 1)
			.itemEnded("c", "i1", "done")
			.item("c", "i2", 2)
			.itemEnded("c", "i2", "failed")
			.item("c", "i3", 3)
			.step("w", "w", "agent", { parentStepId: "c", itemId: "i3" });
		const closing = closingEvents(events, STOPPED, FLOWS);
		expect(
			closing.map((e) => (e.type === "RunEnded" ? e.type : e.stepId)),
		).toEqual(["w", "c", "RunEnded"]);
		expect(closing[1]).toMatchObject({
			payload: {
				outcome: "stopped",
				outputs: {
					outcome: "stopped",
					done_count: 1,
					failed_count: 1,
					results: [
						{ id: "i1", state: "done" },
						{ id: "i2", state: "failed" },
						{ id: "i3", state: "running" },
					],
				},
			},
		});
	});

	test("a Decision ends with an empty note", () => {
		const { events } = log().started().step("d1", "d", "decision");
		expect(closingEvents(events, STOPPED, FLOWS)).toEqual([
			stepEnded("d1", { note: "", visit: 1 }),
			runEnded("stopped"),
		]);
	});

	test("a run that ended already: nothing to end", () => {
		const { events } = log()
			.started()
			.step("s1", "a", "agent")
			.ended("finished");
		expect(closingEvents(events, STOPPED, FLOWS)).toEqual([
			stepEnded("s1", { visit: 1 }),
		]);
		expect(
			closingEvents(log().started().ended("finished").events, STOPPED, FLOWS),
		).toEqual([]);
	});
});

describe("closingEvents: a missed deadline", () => {
	test("the overdue step gets its timer's error; its caller and the run fail with the step's reason", () => {
		const { events } = log()
			.started()
			.step("c", "once", "call")
			.step("w", "w", "agent", { parentStepId: "c", itemId: null })
			.session("w", "x");
		const cut: CutShort = {
			kind: "overdue",
			stepId: "w",
			nodeId: "w",
			reason: "timeout",
			error: "The step ran past its time budget.",
		};
		const reason = 'Node "w" failed: The step ran past its time budget.';
		expect(closingEvents(events, cut, FLOWS)).toEqual([
			sessionEnded("w", "x", {
				outcome: "failed",
				error: "The session was aborted.",
				errorKind: "aborted",
			}),
			stepEnded("w", { visit: 1 }, "error", cut.error),
			stepEnded("c", { ended: "", visit: 1 }, "error", reason),
			runEnded("failed", reason),
		]);
	});
});

describe("openWork: what a cut ends", () => {
	test("a stop ends a parked step; an interrupt leaves it open, and the run with it", () => {
		const { events } = log().started().step("g", "d", "decision").gate("g");
		expect(openWork(events, "stopped")).toMatchObject({
			steps: [{ id: "g" }],
			endsRun: true,
		});
		expect(openWork(events, "interrupted")).toEqual({
			sessions: [],
			steps: [],
			endsRun: false,
		});
	});

	test("steps come innermost first", () => {
		const { events } = log()
			.started()
			.step("c", "once", "call")
			.step("w", "w", "agent", { parentStepId: "c", itemId: null });
		expect(openWork(events, "interrupted").steps.map((s) => s.id)).toEqual([
			"w",
			"c",
		]);
	});

	test("an interrupt ends a run only when it ran", () => {
		const running = log().started().step("s1", "a", "agent").session("s1", "x");
		expect(openWork(running.events, "interrupted")).toMatchObject({
			sessions: [{ id: "x" }],
			steps: [{ id: "s1" }],
			endsRun: true,
		});
		const ended = log().started().ended("finished");
		expect(openWork(ended.events, "interrupted").endsRun).toBe(false);
		expect(openWork(ended.events, "stopped").endsRun).toBe(false);
	});
});
