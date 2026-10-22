import { describe, expect, test } from "bun:test";

import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
	Scope,
} from "../log/events";
import { DEFAULT_RESUME_PROMPT } from "./context";
import {
	loggedVisits,
	reenteredNode,
	reentryUpdate,
	resumeTarget,
} from "./reentry";
import { RESUME_RULES, type ResumePoint, resumePoint } from "./resume-point";
import type { RunStateValues } from "./state";

/**
 * The daemon side of a resume as a table: what `RunResumed` records and how
 * the thread moves, from the log and where the thread is. The log is built
 * in memory (the module only reads). Where a row says what a node will
 * find, it asks the node side (`resumePoint`) too, so the two sides agree.
 */

/** An in-memory log: events get their seq in order. */
function logOf(
	...entries: {
		[T in EngineEventType]: {
			type: T;
			payload: EnginePayloads[T];
			stepId?: string;
			sessionId?: string;
		};
	}[EngineEventType][]
): LoggedEvent[] {
	return entries.map(
		(e, i) =>
			({
				seq: i + 1,
				runId: "run",
				stepId: e.stepId ?? null,
				sessionId: e.sessionId ?? null,
				type: e.type,
				payload: e.payload,
				at: 1_000 + i,
			}) as LoggedEvent,
	);
}

type Ev = Parameters<typeof logOf>[number];

const started = (
	stepId: string,
	nodeId: string,
	visit = 1,
	scope: Scope | null = null,
	nodeType: "agent" | "call" | "decision" = "agent",
): Ev => ({
	type: "StepStarted",
	stepId,
	payload: {
		nodeId,
		nodeType,
		visit,
		transcriptPath: `/t/${stepId}.ndjson`,
		logPath: null,
		scope,
	},
});
const session = (stepId: string, harnessSessionId: string): Ev[] => [
	{
		type: "SessionStarted",
		stepId,
		sessionId: `${stepId}-s`,
		payload: { prompt: "Go", resumeSessionId: null, harness: "claude-code" },
	},
	{
		type: "HarnessSessionAssigned",
		stepId,
		sessionId: `${stepId}-s`,
		payload: { harnessSessionId, model: null },
	},
];
const ended = (
	stepId: string,
	outcome: "pass" | "error" | "interrupted" = "interrupted",
): Ev => ({
	type: "StepEnded",
	stepId,
	payload: { outcome, outputs: { outcome, visit: 1 }, error: null },
});
const edgeTaken = (from: string, to: string): Ev => ({
	type: "EdgeTaken",
	payload: { edgeId: `${from}-${to}`, from, to, outcome: "pass", scope: null },
});

const stateOf = (
	over: Partial<Pick<RunStateValues, "pending" | "loops" | "visits">> = {},
): Pick<RunStateValues, "pending" | "loops" | "visits"> => ({
	pending: null,
	loops: {},
	visits: {},
	...over,
});

/** The point without the step object. */
function summary(point: ResumePoint) {
	if (point.kind === "new") return { kind: "new" };
	return {
		kind: point.kind,
		stepId: point.step.id,
		harnessSessionId: point.harnessSessionId,
		prompt: point.prompt,
	};
}

describe("the daemon side agrees with the node side", () => {
	test("a finished run re-enters on its last top-level step: reenteredNode names it, resumeTarget names its session, reentryUpdate leaves its visit uncommitted", () => {
		const events = logOf(
			started("s1", "a", 1),
			...session("s1", "h-a"),
			ended("s1", "pass"),
			edgeTaken("a", "b"),
			started("s2", "b", 1),
			...session("s2", "h-b"),
			ended("s2", "pass"),
		);
		expect(reenteredNode(events)).toBe("b");
		expect(resumeTarget(events)).toEqual({
			nodeId: "b",
			stepId: "s2",
			scope: null,
			topNodeId: "b",
		});
		const flow = {
			nodes: [{ id: "a" }, { id: "b" }],
		} as unknown as Parameters<typeof reentryUpdate>[0];
		const seed = reentryUpdate(flow, events);
		expect(seed.visits).toEqual({ a: 1 });
		// With that seed, node b finds its step uncommitted and the Agent rule reopens it.
		const point = resumePoint(
			{ id: "b" },
			stateOf({ visits: seed.visits ?? {} }),
			events,
			null,
			RESUME_RULES.agent,
		);
		expect(summary(point)).toEqual({
			kind: "reopen",
			stepId: "s2",
			harnessSessionId: "h-b",
			prompt: DEFAULT_RESUME_PROMPT,
		});
	});

	test("the walk moved on after its last step: the edge's target, no step to continue", () => {
		const events = logOf(
			started("s1", "a", 1),
			...session("s1", "h-a"),
			ended("s1", "pass"),
			edgeTaken("a", "b"),
		);
		expect(reenteredNode(events)).toBeNull();
		expect(resumeTarget(events)).toEqual({
			nodeId: "b",
			stepId: null,
			scope: null,
			topNodeId: "b",
		});
	});

	test("a step without a harness session is no resume target, as the Agent rule would not take it up", () => {
		const events = logOf(started("s1", "a", 1), ended("s1", "interrupted"));
		expect(resumeTarget(events)?.stepId).toBeNull();
		expect(
			resumePoint({ id: "a" }, stateOf(), events, null, RESUME_RULES.agent),
		).toEqual({ kind: "new" });
	});

	test("a step inside a called flow: the target is the body step, the top node its caller", () => {
		const scope: Scope = { parentStepId: "s1", itemId: null };
		const events = logOf(
			started("s1", "caller", 1, null, "call"),
			started("s2", "inner", 1, scope),
			...session("s2", "h-in"),
		);
		expect(resumeTarget(events)).toEqual({
			nodeId: "inner",
			stepId: "s2",
			scope,
			topNodeId: "caller",
		});
		expect(reenteredNode(events)).toBe("caller");
	});

	test("no step yet: no target, no re-entered node", () => {
		expect(resumeTarget(logOf())).toBeNull();
		expect(reenteredNode(logOf())).toBeNull();
	});

	test("the visits are the log's counts: no step is left uncommitted", () => {
		const flow = {
			nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
		} as unknown as Parameters<typeof loggedVisits>[0];
		const events = logOf(
			started("s1", "a", 1),
			...session("s1", "h-1"),
			ended("s1", "pass"),
			started("s2", "b", 1, null, "decision"),
			ended("s2", "error"),
			started("s3", "a", 2),
		);
		expect(loggedVisits(flow, events, null)).toEqual({ a: 2, b: 1 });
		expect(loggedVisits(flow, events, "a")).toEqual({ a: 1, b: 1 });
	});
});
