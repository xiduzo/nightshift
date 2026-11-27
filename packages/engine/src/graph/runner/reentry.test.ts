import { describe, expect, test } from "bun:test";
import { FLOW_VERSION } from "@nightshift/flows";

import { foldRun } from "../../log";
import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
} from "../../log/events/events";
import type { Scope } from "../../log/events/step/step-payloads";
import { DEFAULT_RESUME_PROMPT } from "../context/context";
import { reenteredNode } from "../position/run-position";
import type { Parked, RunStateValues } from "../state/state";
import {
	RESUME_RULES,
	type ResumePoint,
	rerunEntryOf,
	resumePoint,
} from "../step/resume-point";
import {
	DAEMON_RESUME_PROMPT,
	DAEMON_RESUME_REASON,
	planReentry,
	type ReentryRequest,
	reentryUpdate,
} from "./reentry";
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
	pending: {},
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

/** The run failed on the end of `nodeId`, which no edge leaves. */
const runFailed = (nodeId: string, seq: number): LoggedEvent => ({
	...(logOf({
		type: "RunEnded",
		payload: {
			status: "failed",
			reason: `Node "${nodeId}" ended with "pass" and no edge leaves it on that outcome.`,
			node: nodeId,
		},
	})[0] as LoggedEvent),
	seq,
});

/** What `RunResumed` names, for a thread that never ran. */
const targetOf = (events: LoggedEvent[]) => {
	const { nodeId, stepId, scope } = plan(events, threadAt(FRESH)).resumed;
	return { nodeId, stepId, scope };
};

describe("the daemon side agrees with the node side", () => {
	test("a finished run re-enters on its last top-level step: reenteredNode names it, RunResumed names its session, reentryUpdate leaves its visit uncommitted", () => {
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
		expect(reenteredNode(foldRun(events))).toBe("b");
		expect(targetOf(events)).toEqual({
			nodeId: "b",
			stepId: "s2",
			scope: null,
		});
		const flow = {
			nodes: [{ id: "a" }, { id: "b" }],
		} as unknown as Parameters<typeof reentryUpdate>[0];
		const seed = reentryUpdate(flow, foldRun(events));
		expect(seed.visits).toEqual({ a: 1 });
		// With that seed, node b finds its step uncommitted and the Agent rule reopens it.
		const point = resumePoint(
			{ id: "b" },
			stateOf({ visits: seed.visits ?? {} }),
			foldRun(events),
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
		expect(targetOf(events)).toEqual({
			nodeId: "a",
			stepId: null,
			scope: null,
		});
		const point = resumePoint(
			{ id: "a" },
			stateOf(),
			foldRun(events),
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
			runEnded("stopped"),
		);
		expect(reenteredNode(foldRun(events))).toBeNull();
		expect(targetOf(events)).toEqual({
			nodeId: "b",
			stepId: null,
			scope: null,
		});
	});

	test("a step without a harness session is no resume target, as the Agent rule would not take it up", () => {
		const events = logOf(
			started("s1", "a", 1),
			ended("s1", "interrupted"),
			runEnded("stopped"),
		);
		expect(targetOf(events)?.stepId).toBeNull();
		expect(
			resumePoint(
				{ id: "a" },
				stateOf(),
				foldRun(events),
				null,
				RESUME_RULES.agent,
			),
		).toEqual({ kind: "new" });
	});

	test("a step inside a called flow: the target is the body step, the top node its caller", () => {
		const scope: Scope = { parentStepId: "s1", itemId: null };
		const events = logOf(
			started("s1", "caller", 1, null, "call"),
			started("s2", "inner", 1, scope),
			...session("s2", "h-in"),
			runEnded("stopped"),
		);
		expect(targetOf(events)).toEqual({
			nodeId: "inner",
			stepId: "s2",
			scope,
		});
		expect(reenteredNode(foldRun(events))).toBe("caller");
	});

	test("no step yet: no re-entered node", () => {
		expect(reenteredNode(foldRun(logOf()))).toBeNull();
	});
});

/** A flow of three top-level nodes: two Agents and a Call. */
const FLOW = {
	version: FLOW_VERSION,
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
		endedTasks: [],
		answered: [],
		...over,
	};
}
const at = (value: Parked): ThreadState => ({
	kind: "interrupted",
	value,
	interrupts: [{ id: "i1", value }],
});
const parkedAt = (stepId: string | null, nodeId = "b"): ThreadState =>
	at({ kind: "parked", stepId, nodeId, status: "stopped", reason: null });
const gateAt = (stepId: string): ThreadState =>
	at({
		kind: "gate",
		stepId,
		nodeId: "b",
		question: "Ship it?",
		choices: [],
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
) => planReentry({ flow: FLOW, run: foldRun(events), thread, request, now });

describe("planReentry: a resume", () => {
	test("at a parked step: the interrupt is answered, and RunResumed names the step's session and the prompt", () => {
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
				value: { kind: "resume" },
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
			value: { kind: "resume" },
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
			value: { kind: "resume" },
		});
	});

	test("the daemon died before the end of a park: the thread parks again, and nothing runs", () => {
		const parked = (stopAt: number | null = null) =>
			logOf(
				runStarted(stopAt),
				started("s1", "a", 1),
				...session("s1", "h-a"),
				ended("s1", "error"),
				{
					type: "RunEnded",
					payload: { status: "interrupted", reason: "Night Shift stopped." },
				},
			);
		const events = parked();
		const daemon = { kind: "resume", by: "daemon" } as const;
		expect(plan(events, threadAt(parkedAt("s1", "a")), daemon)).toEqual({
			resumed: {
				nodeId: "a",
				stepId: null,
				prompt: null,
				scope: null,
				by: "daemon",
				reason: DAEMON_RESUME_REASON,
			},
			entry: { kind: "continue" },
			clearTasks: false,
		});
		// The stop time stays: the thread, which parks again, keeps it too.
		const past = plan(
			parked(5_000),
			threadAt(parkedAt("s1", "a")),
			daemon,
			5_000,
		);
		expect(past.entry).toEqual({ kind: "continue" });
		expect(past.resumed).not.toHaveProperty("clearStopAt");
		// A person who resumes it asks for the step again.
		expect(plan(events, threadAt(parkedAt("s1", "a"))).entry).toEqual({
			kind: "resume",
			value: { kind: "resume" },
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
			update: reentryUpdate(FLOW, foldRun(events)),
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

	describe("the one session that gets the prompt", () => {
		const scope: Scope = { parentStepId: "c1", itemId: null };
		const pending = (...next: string[]) => threadAt({ kind: "pending", next });
		/** `caller` runs an Agent `w` that a stop ended, beside `b`, which passed. */
		const beside = (callEnd: "stopped" | "pass") =>
			logOf(
				runStarted(),
				started("c1", "caller", 1, null, "call"),
				started("w1", "w", 1, scope),
				...session("w1", "h-w"),
				started("b1", "b", 1),
				...session("b1", "h-b"),
				ended("b1", "pass"),
				ended("w1", "stopped"),
				ended("c1", callEnd),
				runEnded("stopped"),
			);

		test("a task inside a called flow: the Agent there, not the later step that is done", () => {
			expect(
				plan(beside("stopped"), pending("caller", "b")).resumed,
			).toMatchObject({ nodeId: "w", stepId: "w1", scope });
		});

		test("a task that is done: none of its sessions goes on", () => {
			expect(
				plan(beside("pass"), pending("caller", "b")).resumed.stepId,
			).toBeNull();
		});

		test("a step that parked on its own end opens again; a Gate's step that a person ended does not", () => {
			const events = logOf(
				runStarted(),
				started("s2", "b", 1),
				...session("s2", "h-b"),
				ended("s2", "pass"),
			);
			const parked = [...events, runFailed("b", events.length + 1)];
			expect(plan(parked, threadAt(parkedAt("s2"))).resumed.stepId).toBe("s2");
			const stopped = logOf(
				runStarted(),
				started("s2", "b", 1),
				...session("s2", "h-b"),
				ended("s2", "pass"),
				runEnded("stopped"),
			);
			expect(plan(stopped, threadAt(gateAt("s2"))).resumed.stepId).toBeNull();
		});

		test("a branch that parked with no session: its node, not the later step of another branch", () => {
			const node = (id: string, type: string) => ({ id, type });
			const flow = {
				version: FLOW_VERSION,
				start: "a",
				nodes: [
					node("a", "command"),
					node("b", "command"),
					node("c", "command"),
					{ ...node("j", "join"), wait: "all" },
				],
				edges: [
					["a", "b"],
					["a", "c"],
					["b", "j"],
					["c", "j"],
				].map(([from, to]) => ({
					id: `${from}${to}`,
					from,
					to,
					outcome: "pass",
				})),
			} as unknown as typeof FLOW;
			const events = logOf(
				runStarted(),
				started("b1", "b", 1, null, "decision"),
				started("c1", "c", 1, null, "decision"),
				ended("c1", "pass"),
				ended("b1", "error"),
				runEnded("failed"),
			);
			const planned = planReentry({
				flow,
				run: foldRun(events),
				thread: threadAt(parkedAt("b1")),
				request: BY_PERSON,
				now: 0,
			});
			expect(planned.resumed).toMatchObject({ nodeId: "b", stepId: null });
		});

		test("a step that went on with an earlier session, and whose own got no name", () => {
			const events = logOf(
				runStarted(),
				started("s2", "b", 1),
				{
					type: "SessionStarted",
					stepId: "s2",
					sessionId: "x",
					payload: {
						prompt: "Go",
						resumeSessionId: "h-a",
						harness: "claude-code",
					},
				},
				ended("s2", "error"),
			);
			events.push(runFailed("b", events.length + 1));
			expect(plan(events, threadAt(parkedAt("s2"))).resumed.stepId).toBe("s2");
		});
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

	test("a run that runs or waits is refused, by the run's own rule; a sleeping one is the runner's to wake", () => {
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
			"A sleeping run wakes. It does not re-enter.",
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
			update: reentryUpdate(FLOW, foldRun(events), null),
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
				foldRun(after(events, planned.resumed)),
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
			foldRun(after(events, planned.resumed)),
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
					foldRun(after(events, planned.resumed)),
					null,
				),
			).toEqual(expected);
		}
	});
});
