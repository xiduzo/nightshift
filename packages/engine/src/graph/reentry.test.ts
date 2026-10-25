import { describe, expect, test } from "bun:test";

import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
	Scope,
} from "../log/events";
import { DEFAULT_RESUME_PROMPT } from "./context";
import {
	DAEMON_RESUME_PROMPT,
	DAEMON_RESUME_REASON,
	planReentry,
	type ReentryRequest,
	reentryUpdate,
	resumeTarget,
} from "./reentry";
import {
	RESUME_RULES,
	type ResumePoint,
	rerunEntryOf,
	resumePoint,
} from "./resume-point";
import { reenteredNode } from "./run-position";
import type { Parked, RunStateValues } from "./state";
import type { ThreadSnapshot, ThreadState } from "./thread";

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
	outcome: "pass" | "error" | "stopped" | "interrupted" = "interrupted",
): Ev => ({
	type: "StepEnded",
	stepId,
	payload: { outcome, outputs: { outcome, visit: 1 }, error: null },
});
const runStarted = (stopAt: number | null = null): Ev => ({
	type: "RunStarted",
	payload: { projectId: "p", flowName: "f", title: "f", start: "a", stopAt },
});
const runEnded = (status: "finished" | "stopped" | "failed"): Ev => ({
	type: "RunEnded",
	payload: { status, reason: null },
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
	if (point.kind === "done") return { kind: "done", stepId: point.step.id };
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
			runEnded("finished"),
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

	test("a last step that ended before its commit, in a run that did not finish, is done: no session continues, the node goes on from its end", () => {
		const events = logOf(
			runStarted(),
			started("s1", "a", 1),
			...session("s1", "h-a"),
			ended("s1", "pass"),
			runEnded("stopped"),
		);
		expect(resumeTarget(events)).toEqual({
			nodeId: "a",
			stepId: null,
			scope: null,
			topNodeId: "a",
		});
		const point = resumePoint(
			{ id: "a" },
			stateOf(),
			events,
			null,
			RESUME_RULES.agent,
		);
		expect(summary(point)).toEqual({ kind: "done", stepId: "s1" });
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
});

/** A flow of three top-level nodes: two Agents and a Call. */
const FLOW = {
	version: 2,
	start: "a",
	nodes: [
		{ id: "a", type: "agent", prompt: "first" },
		{ id: "b", type: "agent", prompt: "second" },
		{ id: "caller", type: "call", flow: "inner" },
	],
	edges: [],
} as unknown as Parameters<typeof planReentry>[0]["flow"];

/** The thread as the runner reads it from the latest checkpoint. */
function threadAt(
	state: ThreadState,
	over: Partial<Omit<ThreadSnapshot, "state">> = {},
): ThreadSnapshot {
	return {
		state,
		values: {},
		hasCheckpoint: state.kind !== "fresh",
		hasTasks: state.kind === "interrupted" || state.kind === "pending",
		...over,
	};
}
const parkedAt = (stepId: string | null, nodeId = "b"): ThreadState => ({
	kind: "interrupted",
	value: { kind: "parked", stepId, nodeId, status: "stopped", reason: null },
});
const gateAt = (stepId: string): ThreadState => ({
	kind: "interrupted",
	value: {
		kind: "gate",
		stepId,
		nodeId: "b",
		question: "Ship it?",
		choices: [],
	} satisfies Parked,
});
const PENDING: ThreadState = { kind: "pending", next: ["b"] };
const ENDED: ThreadState = {
	kind: "ended",
	ended: { status: "finished", reason: null } as never,
};
const FRESH: ThreadState = { kind: "fresh" };

const BY_PERSON: ReentryRequest = { kind: "resume", by: "person" };

/** A walk that ran `a`, then `b` with a harness session, and was stopped there. */
const stoppedInB = (stopAt: number | null = null) =>
	logOf(
		runStarted(stopAt),
		started("s1", "a", 1),
		...session("s1", "h-a"),
		ended("s1", "pass"),
		edgeTaken("a", "b"),
		started("s2", "b", 1),
		...session("s2", "h-b"),
		ended("s2", "stopped"),
		runEnded("stopped"),
	);

const plan = (
	events: LoggedEvent[],
	thread: ThreadSnapshot,
	request: ReentryRequest = BY_PERSON,
	now = 0,
) => planReentry({ flow: FLOW, events, thread, request, now });

describe("planReentry: a resume", () => {
	test("at a parked step: the interrupt gets the resume prompt, and RunResumed names the step's session", () => {
		const events = stoppedInB();
		expect(plan(events, threadAt(parkedAt("s2")))).toEqual({
			resumed: {
				nodeId: "b",
				stepId: "s2",
				prompt: DEFAULT_RESUME_PROMPT,
				scope: null,
				by: "person",
			},
			entry: {
				kind: "resume",
				value: { kind: "resume", prompt: DEFAULT_RESUME_PROMPT },
			},
			clearTasks: false,
		});
		const withPrompt = plan(events, threadAt(parkedAt("s2")), {
			kind: "resume",
			by: "person",
			prompt: "Fix the test.",
		});
		expect(withPrompt.resumed.prompt).toBe("Fix the test.");
		expect(withPrompt.entry).toEqual({
			kind: "resume",
			value: { kind: "resume", prompt: "Fix the test." },
		});
	});

	test("at a Gate the run was stopped at: the Gate asks again, and there is no session", () => {
		const events = logOf(
			runStarted(),
			started("g1", "b", 1, null, "decision"),
			{
				type: "GateOpened",
				stepId: "g1",
				payload: { question: "Ship it?", choices: [] },
			},
			ended("g1", "stopped"),
			runEnded("stopped"),
		);
		expect(plan(events, threadAt(gateAt("g1")))).toEqual({
			resumed: {
				nodeId: "b",
				stepId: null,
				prompt: null,
				scope: null,
				by: "person",
			},
			entry: { kind: "resume", value: { kind: "reopen" } },
			clearTasks: false,
		});
	});

	test("the daemon's resume: its own prompt, and why", () => {
		const daemon = plan(stoppedInB(), threadAt(parkedAt("s2")), {
			kind: "resume",
			by: "daemon",
		});
		expect(daemon.resumed).toEqual({
			nodeId: "b",
			stepId: "s2",
			prompt: DAEMON_RESUME_PROMPT,
			scope: null,
			by: "daemon",
			reason: DAEMON_RESUME_REASON,
		});
		expect(daemon.entry).toEqual({
			kind: "resume",
			value: { kind: "resume", prompt: DAEMON_RESUME_PROMPT },
		});
	});

	test("a node pending without an interrupt runs again; past the stop time, the stop time clears", () => {
		expect(plan(stoppedInB(), threadAt(PENDING)).entry).toEqual({
			kind: "continue",
		});
		const late = plan(stoppedInB(5_000), threadAt(PENDING), BY_PERSON, 5_000);
		expect(late.resumed.clearStopAt).toBe(true);
		expect(late.entry).toEqual({ kind: "continue", update: { stopAt: null } });
		// Before the stop time: nothing to clear.
		expect(
			plan(stoppedInB(5_000), threadAt(PENDING), BY_PERSON, 4_999).resumed,
		).not.toHaveProperty("clearStopAt");
	});

	test("a thread that ended: a jump to the last top-level node, its visit taken back", () => {
		const events = stoppedInB();
		const finished = threadAt(ENDED, { values: { visits: { a: 1, b: 1 } } });
		expect(plan(events, finished).entry).toEqual({
			kind: "goto",
			nodeId: "b",
			update: { ended: null, pending: null, visits: { b: 0 } },
		});
		// The walk moved on from its last step: no visit to take back.
		const movedOn = logOf(
			runStarted(),
			started("s1", "a", 1),
			ended("s1", "pass"),
			edgeTaken("a", "b"),
			runEnded("stopped"),
		);
		expect(
			plan(movedOn, threadAt(ENDED, { values: { visits: { a: 1 } } })),
		).toMatchObject({
			resumed: { nodeId: "b", stepId: null },
			entry: {
				kind: "goto",
				nodeId: "b",
				update: { ended: null, pending: null },
			},
		});
		expect(
			plan(movedOn, threadAt(ENDED, { values: { visits: { a: 1 } } })).entry,
		).not.toHaveProperty("update.visits");
	});

	test("a thread with no checkpoint is seeded from the log", () => {
		const events = stoppedInB();
		expect(plan(events, threadAt(FRESH)).entry).toEqual({
			kind: "goto",
			nodeId: "b",
			update: reentryUpdate(FLOW, events),
		});
	});

	test("inside a called flow: RunResumed names the body step, the jump its caller", () => {
		const scope: Scope = { parentStepId: "c1", itemId: null };
		const events = logOf(
			runStarted(),
			started("c1", "caller", 1, null, "call"),
			started("w1", "w", 1, scope),
			...session("w1", "h-w"),
			ended("w1", "interrupted"),
			ended("c1", "interrupted"),
			runEnded("failed"),
		);
		const planned = plan(events, threadAt(FRESH));
		expect(planned.resumed).toMatchObject({ nodeId: "w", stepId: "w1", scope });
		expect(planned.entry).toMatchObject({ kind: "goto", nodeId: "caller" });
	});

	test("no step yet: the flow's start", () => {
		const planned = plan(
			logOf(runStarted(), runEnded("failed")),
			threadAt(FRESH),
		);
		expect(planned.resumed).toMatchObject({
			nodeId: "a",
			stepId: null,
			prompt: null,
		});
		expect(planned.entry).toMatchObject({ kind: "goto", nodeId: "a" });
	});

	test("a restart records its action", () => {
		expect(
			plan(stoppedInB(), threadAt(parkedAt("s2")), {
				kind: "resume",
				by: "person",
				action: "restart",
			}).resumed.action,
		).toBe("restart");
	});

	test("a run that runs, waits or sleeps is refused", () => {
		const running = logOf(runStarted(), started("s1", "a", 1));
		expect(() => plan(running, threadAt(PENDING))).toThrow(
			"This run is still running. Stop it or wait for it to end.",
		);
		const waiting = logOf(
			runStarted(),
			started("g1", "b", 1, null, "decision"),
			{
				type: "GateOpened",
				stepId: "g1",
				payload: { question: "?", choices: [] },
			},
		);
		expect(() => plan(waiting, threadAt(gateAt("g1")))).toThrow(
			"This run waits at a Gate. Answer the Gate, or stop the run first.",
		);
		const sleeping = logOf(runStarted(), started("s1", "a", 1), {
			type: "WaitStarted",
			stepId: "s1",
			payload: {
				reason: "usage-limit",
				until: 9_000,
				message: "Waits.",
				since: 1,
			},
		});
		expect(() => plan(sleeping, threadAt(PENDING))).toThrow(
			"This run sleeps until a wait ends. Resume it again to wake it now.",
		);
	});
});

describe("planReentry: a rerun", () => {
	const rerun = (
		over: Partial<Extract<ReentryRequest, { kind: "rerun" }>> = {},
	): ReentryRequest => ({ kind: "rerun", by: "person", nodeId: "a", ...over });
	const loops = {
		values: { visits: { a: 1, b: 1 }, loops: { caller: { index: 2 } } },
	};

	test("an Agent continues its latest top-level session with Resume's prompt; the thread jumps with the log's visits", () => {
		const events = stoppedInB();
		expect(plan(events, threadAt(ENDED, loops), rerun())).toEqual({
			resumed: {
				nodeId: "a",
				stepId: "s1",
				prompt: DEFAULT_RESUME_PROMPT,
				scope: null,
				by: "person",
				action: "rerun",
			},
			entry: {
				kind: "goto",
				nodeId: "a",
				update: {
					ended: null,
					pending: null,
					visits: { a: 1, b: 1 },
					loops: { caller: null },
				},
			},
			clearTasks: false,
		});
	});

	test("a thread that still has a task has it cleared first; one with no checkpoint is seeded from the log", () => {
		const events = stoppedInB();
		for (const state of [parkedAt("s2"), PENDING]) {
			expect(plan(events, threadAt(state, loops), rerun()).clearTasks).toBe(
				true,
			);
		}
		const fresh = plan(events, threadAt(FRESH), rerun());
		expect(fresh.clearTasks).toBe(false);
		expect(fresh.entry).toEqual({
			kind: "goto",
			nodeId: "a",
			update: reentryUpdate(FLOW, events, null),
		});
	});

	test("a named step, a prompt, a fresh session, a node with no session", () => {
		const events = stoppedInB();
		expect(
			plan(
				events,
				threadAt(ENDED),
				rerun({ nodeId: "b", stepId: "s2", prompt: "Again." }),
			).resumed,
		).toMatchObject({ nodeId: "b", stepId: "s2", prompt: "Again." });
		expect(
			plan(events, threadAt(ENDED), rerun({ fresh: true })).resumed,
		).toMatchObject({ stepId: null, prompt: null });
		expect(
			plan(events, threadAt(ENDED), rerun({ nodeId: "caller" })).resumed,
		).toMatchObject({ nodeId: "caller", stepId: null, prompt: null });
	});

	test("a step of another node and a node that is not top-level are refused", () => {
		const events = stoppedInB();
		expect(() =>
			plan(events, threadAt(ENDED), rerun({ nodeId: "a", stepId: "s2" })),
		).toThrow('That step is not a step of "a" in the run\'s own flow.');
		expect(() => plan(events, threadAt(ENDED), rerun({ nodeId: "w" }))).toThrow(
			'This run\'s flow has no node "w".',
		);
	});
});

describe("planReentry keeps its promise: the node finds what RunResumed records", () => {
	/** The log after the plan's RunResumed. */
	const after = (events: LoggedEvent[], resumed: object) =>
		logOf(
			...(events.map(({ type, payload, stepId, sessionId }) => ({
				type,
				payload,
				...(stepId ? { stepId } : {}),
				...(sessionId ? { sessionId } : {}),
			})) as Ev[]),
			{ type: "RunResumed", payload: resumed } as Ev,
		);

	test("a resume of an ended thread: the node reopens the step RunResumed names, with its prompt", () => {
		const events = stoppedInB();
		for (const request of [
			BY_PERSON,
			{ kind: "resume", by: "daemon" } as const,
			{ kind: "resume", by: "person", prompt: "Look again." } as const,
		]) {
			const planned = plan(
				events,
				threadAt(ENDED, { values: { visits: { a: 1, b: 1 } } }),
				request,
			);
			if (planned.entry.kind !== "goto") throw new Error("expected a jump");
			const point = resumePoint(
				{ id: planned.entry.nodeId },
				stateOf({ visits: { a: 1, b: 1, ...planned.entry.update.visits } }),
				after(events, planned.resumed),
				null,
				RESUME_RULES.agent,
			);
			expect(planned.resumed.stepId).toBe("s2");
			expect(summary(point)).toEqual({
				kind: "reopen",
				stepId: "s2",
				harnessSessionId: "h-b",
				prompt: planned.resumed.prompt,
			});
		}
	});

	test("a resume of a thread with no checkpoint: the same, from the seed", () => {
		const events = stoppedInB();
		const planned = plan(events, threadAt(FRESH));
		if (planned.entry.kind !== "goto") throw new Error("expected a jump");
		const point = resumePoint(
			{ id: "b" },
			stateOf({ visits: planned.entry.update.visits ?? {} }),
			after(events, planned.resumed),
			null,
			RESUME_RULES.agent,
		);
		expect(summary(point)).toMatchObject({
			kind: "reopen",
			stepId: "s2",
			prompt: planned.resumed.prompt,
		});
	});

	test("a rerun: the node's first visit continues the session RunResumed names", () => {
		const events = stoppedInB();
		for (const [request, expected] of [
			[
				{ kind: "rerun", by: "person", nodeId: "a" },
				{ harnessSessionId: "h-a", prompt: DEFAULT_RESUME_PROMPT },
			],
			[
				{ kind: "rerun", by: "person", nodeId: "b", prompt: "Again." },
				{ harnessSessionId: "h-b", prompt: "Again." },
			],
			[{ kind: "rerun", by: "person", nodeId: "a", fresh: true }, null],
		] as const) {
			const planned = plan(events, threadAt(ENDED), request);
			expect(
				rerunEntryOf(
					{ id: request.nodeId },
					after(events, planned.resumed),
					null,
				),
			).toEqual(expected);
		}
	});
});
