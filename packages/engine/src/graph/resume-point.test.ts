import { describe, expect, test } from "bun:test";

import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
	Scope,
} from "../log/events";
import { DEFAULT_RESUME_PROMPT } from "./context";
import {
	entryOf,
	loggedVisits,
	RESUME_RULES,
	type ResumePoint,
	type ResumeRules,
	reenteredNode,
	reentryUpdate,
	rerunEntryOf,
	resumePoint,
	resumeTarget,
	uncommittedStep,
} from "./resume-point";
import type { Pending, RunStateValues } from "./state";

/**
 * The resume-point rules as a table: for each situation a node can re-enter
 * in, what every node kind does. The log is built in memory (no database),
 * because the module only reads; the node tests drive the real graph.
 */

type Kind = keyof typeof RESUME_RULES;
const KINDS = Object.keys(RESUME_RULES) as Kind[];

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

const NODE = { id: "n1" };

type Ev = Parameters<typeof logOf>[number];

const started = (
	stepId: string,
	nodeId = NODE.id,
	visit = 1,
	scope: Scope | null = null,
	nodeType: "agent" | "call" | "decision" | "wait" = "agent",
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
	outcome:
		| "pass"
		| "stopped"
		| "error"
		| "interrupted"
		| "done" = "interrupted",
): Ev => ({
	type: "StepEnded",
	stepId,
	payload: { outcome, outputs: { outcome, visit: 1 }, error: null },
});
const resumed = (stepId: string | null, prompt: string | null): Ev => ({
	type: "RunResumed",
	payload: { nodeId: NODE.id, stepId, prompt, scope: null, by: "person" },
});
const gateOpened = (stepId: string): Ev => ({
	type: "GateOpened",
	stepId,
	payload: { question: "Ship it?", choices: [{ name: "yes" }, { name: "no" }] },
});
const edgeTaken = (
	from: string,
	to: string,
	scope: Scope | null = null,
): Ev => ({
	type: "EdgeTaken",
	payload: { edgeId: `${from}-${to}`, from, to, outcome: "pass", scope },
});

const stateOf = (
	over: Partial<Pick<RunStateValues, "pending" | "loops" | "visits">> = {},
): Pick<RunStateValues, "pending" | "loops" | "visits"> => ({
	pending: null,
	loops: {},
	visits: {},
	...over,
});

const waitPending = (
	stepId: string,
	harnessSessionId: string | null,
): Pending => ({
	kind: "wait",
	stepId,
	nodeId: NODE.id,
	visit: 1,
	reason: "usage-limit",
	until: 2_000,
	message: "Waits.",
	streak: { count: 1, since: 1_000 },
	session: { harnessSessionId, prompt: "Carry on." },
});
const parkedPending = (
	stepId: string | null,
	harnessSessionId: string | null,
	prompt: string | null = null,
): Pending => ({
	kind: "parked",
	stepId,
	nodeId: NODE.id,
	visit: 1,
	harnessSessionId,
	prompt,
	status: "stopped",
	reason: null,
});

/** A point without the step object: one cell of the table. */
type Point =
	| { kind: "new" }
	| {
			kind: "continue" | "reopen";
			stepId: string;
			harnessSessionId: string | null;
			prompt: string | null;
	  };

/** The point without the step object, for the table. */
function summary(point: ResumePoint): Point {
	if (point.kind === "new") return { kind: "new" };
	return {
		kind: point.kind,
		stepId: point.step.id,
		harnessSessionId: point.harnessSessionId,
		prompt: point.prompt,
	};
}

/** Runs one situation through every kind and compares with the expected table. */
function expectTable(
	situation: {
		state: Pick<RunStateValues, "pending" | "loops" | "visits">;
		events: LoggedEvent[];
		scope?: Scope | null;
	},
	expected: Record<Kind, Point>,
) {
	for (const kind of KINDS) {
		const rules: ResumeRules = RESUME_RULES[kind];
		const point = resumePoint(
			NODE,
			situation.state,
			situation.events,
			situation.scope ?? null,
			rules,
		);
		expect({ kind, point: summary(point) }).toEqual({
			kind,
			point: expected[kind],
		});
	}
}

const NEW = { kind: "new" } as const;
const all = (point: Point) =>
	Object.fromEntries(KINDS.map((k) => [k, point])) as Record<Kind, Point>;

describe("resumePoint", () => {
	test("a fresh node: every kind starts a new visit", () => {
		expectTable({ state: stateOf(), events: logOf() }, all(NEW));
	});

	test("a committed earlier visit is not taken up: a new visit", () => {
		expectTable(
			{
				state: stateOf({ visits: { [NODE.id]: 1 } }),
				events: logOf(
					started("s1"),
					...session("s1", "h1"),
					ended("s1", "pass"),
				),
			},
			all(NEW),
		);
	});

	describe("after a wake (pending wait)", () => {
		test("the step is still open: it continues, with its harness session and the wait's prompt", () => {
			const events = logOf(started("s1"), ...session("s1", "h1"));
			const point: Point = {
				kind: "continue",
				stepId: "s1",
				harnessSessionId: "h1",
				prompt: "Carry on.",
			};
			expectTable(
				{ state: stateOf({ pending: waitPending("s1", "h1") }), events },
				all(point),
			);
		});

		test("without a harness session the continued step has no follow-up prompt", () => {
			const events = logOf(started("s1", NODE.id, 1, null, "decision"));
			expectTable(
				{ state: stateOf({ pending: waitPending("s1", null) }), events },
				all({
					kind: "continue",
					stepId: "s1",
					harnessSessionId: null,
					prompt: null,
				}),
			);
		});

		test("recovery ended the step after the wake: it is reopened, with the daemon's resume prompt over the wait's", () => {
			const events = logOf(
				started("s1"),
				...session("s1", "h1"),
				ended("s1", "interrupted"),
				resumed("s1", "Night Shift stopped. Continue."),
			);
			expectTable(
				{ state: stateOf({ pending: waitPending("s1", "h1") }), events },
				all({
					kind: "reopen",
					stepId: "s1",
					harnessSessionId: "h1",
					prompt: "Night Shift stopped. Continue.",
				}),
			);
		});

		test("recovery ended the step, no resume for it: the wait's prompt; no session: a reopen without a prompt", () => {
			const withSession = logOf(
				started("s1"),
				...session("s1", "h1"),
				ended("s1", "interrupted"),
			);
			expectTable(
				{
					state: stateOf({ pending: waitPending("s1", "h1") }),
					events: withSession,
				},
				all({
					kind: "reopen",
					stepId: "s1",
					harnessSessionId: "h1",
					prompt: "Carry on.",
				}),
			);
			const noSession = logOf(started("s1"), ended("s1", "interrupted"));
			expectTable(
				{
					state: stateOf({ pending: waitPending("s1", null) }),
					events: noSession,
				},
				all({
					kind: "reopen",
					stepId: "s1",
					harnessSessionId: null,
					prompt: null,
				}),
			);
		});

		test("another node's wait is not this node's: the log decides", () => {
			const events = logOf(started("s1"), ...session("s1", "h1"));
			const other = { ...waitPending("s1", "h1"), nodeId: "n2" };
			// The step is uncommitted (visits 0, one logged), so the crash rule applies.
			expectTable(
				{ state: stateOf({ pending: other }), events },
				{
					agent: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: DEFAULT_RESUME_PROMPT,
					},
					model: NEW,
					call: {
						kind: "continue",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: "Continue where you left off.",
					},
					callEach: {
						kind: "continue",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: "Continue where you left off.",
					},
					gate: NEW,
					wait: NEW,
					fresh: NEW,
				},
			);
		});
	});

	describe("a person resumed a parked step (pending parked)", () => {
		test("a stopped step with a harness session: the Agent reopens it with the resume prompt; a cut-short loop reopens it; the rest start over", () => {
			const events = logOf(
				started("s1"),
				...session("s1", "h1"),
				ended("s1", "stopped"),
			);
			expectTable(
				{
					state: stateOf({
						pending: parkedPending("s1", "h1", "Finish it."),
						visits: { [NODE.id]: 1 },
					}),
					events,
				},
				{
					agent: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: "Finish it.",
					},
					model: NEW,
					call: NEW,
					callEach: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: "Finish it.",
					},
					gate: NEW,
					wait: NEW,
					fresh: NEW,
				},
			);
		});

		test("no resume prompt yet: the default", () => {
			const events = logOf(
				started("s1"),
				...session("s1", "h1"),
				ended("s1", "stopped"),
			);
			const point = resumePoint(
				NODE,
				stateOf({
					pending: parkedPending("s1", "h1"),
					visits: { [NODE.id]: 1 },
				}),
				events,
				null,
				RESUME_RULES.agent,
			);
			expect(summary(point)).toEqual({
				kind: "reopen",
				stepId: "s1",
				harnessSessionId: "h1",
				prompt: DEFAULT_RESUME_PROMPT,
			});
		});

		test("a parked step without a harness session: the Agent starts a new visit; a cut-short loop still reopens", () => {
			const events = logOf(started("s1"), ended("s1", "error"));
			expectTable(
				{
					state: stateOf({
						pending: parkedPending("s1", null),
						visits: { [NODE.id]: 1 },
					}),
					events,
				},
				{
					agent: NEW,
					model: NEW,
					call: NEW,
					callEach: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: null,
						prompt: null,
					},
					gate: NEW,
					wait: NEW,
					fresh: NEW,
				},
			);
		});

		test("a loop that ran out (done, no edge) is not cut short: a new visit", () => {
			const events = logOf(started("s1"), ended("s1", "done"));
			expectTable(
				{
					state: stateOf({
						pending: parkedPending("s1", null),
						visits: { [NODE.id]: 1 },
					}),
					events,
				},
				all(NEW),
			);
		});

		test("the run parked before the step (no step id): a new visit", () => {
			expectTable(
				{
					state: stateOf({ pending: parkedPending(null, null) }),
					events: logOf(),
				},
				all(NEW),
			);
		});
	});

	describe("a step the checkpoint never saw (the daemon died, rule 5)", () => {
		test("open in the log, with a harness session: the Agent reopens (its process is gone), a Call continues, the rest start over", () => {
			const events = logOf(started("s1"), ...session("s1", "h1"));
			expectTable(
				{ state: stateOf(), events },
				{
					agent: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: DEFAULT_RESUME_PROMPT,
					},
					model: NEW,
					call: {
						kind: "continue",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: DEFAULT_RESUME_PROMPT,
					},
					callEach: {
						kind: "continue",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: DEFAULT_RESUME_PROMPT,
					},
					gate: NEW,
					wait: NEW,
					fresh: NEW,
				},
			);
		});

		test("recovery ended it interrupted and the engine logged the daemon's resume: Agent and Call reopen with that prompt", () => {
			const events = logOf(
				started("s1"),
				...session("s1", "h1"),
				ended("s1", "interrupted"),
				resumed("s1", "Night Shift stopped. Continue."),
			);
			expectTable(
				{ state: stateOf(), events },
				{
					agent: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: "Night Shift stopped. Continue.",
					},
					model: NEW,
					call: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: "Night Shift stopped. Continue.",
					},
					callEach: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: "h1",
						prompt: "Night Shift stopped. Continue.",
					},
					gate: NEW,
					wait: NEW,
					fresh: NEW,
				},
			);
		});

		test("an Agent step that never got a harness session has nothing to continue: a new visit; a Call still reopens it", () => {
			const events = logOf(started("s1"), ended("s1", "interrupted"));
			expectTable(
				{ state: stateOf(), events },
				{
					agent: NEW,
					model: NEW,
					call: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: null,
						prompt: null,
					},
					callEach: {
						kind: "reopen",
						stepId: "s1",
						harnessSessionId: null,
						prompt: null,
					},
					gate: NEW,
					wait: NEW,
					fresh: NEW,
				},
			);
		});

		test("a step in another scope does not count for this one", () => {
			const scope: Scope = { parentStepId: "p", itemId: null };
			const events = logOf(
				started("s1", NODE.id, 1, scope),
				...session("s1", "h1"),
			);
			expectTable({ state: stateOf(), events, scope: null }, all(NEW));
			expect(uncommittedStep(NODE, stateOf(), events, scope)?.id).toBe("s1");
		});
	});

	describe("the Gate's crash window", () => {
		test("opened but not committed: the Gate continues its step (no second Gate); other kinds see a plain crash", () => {
			const events = logOf(
				started("s1", NODE.id, 1, null, "decision"),
				gateOpened("s1"),
			);
			const point = resumePoint(
				NODE,
				stateOf(),
				events,
				null,
				RESUME_RULES.gate,
			);
			expect(summary(point)).toEqual({
				kind: "continue",
				stepId: "s1",
				harnessSessionId: null,
				prompt: null,
			});
			expect(point.kind === "continue" && point.step.gate?.question).toBe(
				"Ship it?",
			);
		});

		test("the step started but GateOpened never made it: a new visit", () => {
			const events = logOf(started("s1", NODE.id, 1, null, "decision"));
			const point = resumePoint(
				NODE,
				stateOf(),
				events,
				null,
				RESUME_RULES.gate,
			);
			expect(point).toEqual({ kind: "new" });
		});

		test("the Gate step ended (the run was stopped at it): not reused, a new visit", () => {
			const events = logOf(
				started("s1", NODE.id, 1, null, "decision"),
				gateOpened("s1"),
				ended("s1", "stopped"),
			);
			const point = resumePoint(
				NODE,
				stateOf(),
				events,
				null,
				RESUME_RULES.gate,
			);
			expect(point).toEqual({ kind: "new" });
		});

		test("a Gate reopened without a new GateOpened is not asked", () => {
			const events = logOf(
				started("s1", NODE.id, 1, null, "decision"),
				gateOpened("s1"),
				{ type: "StepReopened", stepId: "s1", payload: { prompt: null } },
			);
			const point = resumePoint(
				NODE,
				stateOf(),
				events,
				null,
				RESUME_RULES.gate,
			);
			expect(point).toEqual({ kind: "new" });
		});
	});

	describe("mid-loop (a Call with each)", () => {
		test("the cursor is set: the latest step of the node continues while open, is reopened when ended", () => {
			const open = logOf(started("s1", NODE.id, 1, null, "call"));
			const state = stateOf({
				loops: { [NODE.id]: { index: 0 } },
				visits: { [NODE.id]: 1 },
			});
			expect(
				summary(resumePoint(NODE, state, open, null, RESUME_RULES.callEach)),
			).toEqual({
				kind: "continue",
				stepId: "s1",
				harnessSessionId: null,
				prompt: null,
			});
			const closed = logOf(
				started("s1", NODE.id, 1, null, "call"),
				ended("s1", "interrupted"),
			);
			expect(
				summary(resumePoint(NODE, state, closed, null, RESUME_RULES.callEach)),
			).toEqual({
				kind: "reopen",
				stepId: "s1",
				harnessSessionId: null,
				prompt: null,
			});
		});

		test("only a looping kind reads the cursor", () => {
			const events = logOf(started("s1", NODE.id, 1, null, "call"));
			const state = stateOf({
				loops: { [NODE.id]: { index: 0 } },
				visits: { [NODE.id]: 1 },
			});
			expect(resumePoint(NODE, state, events, null, RESUME_RULES.call)).toEqual(
				{
					kind: "new",
				},
			);
		});
	});

	test("entryOf maps the point onto beginStep's StepStart, prompt and all", () => {
		const events = logOf(
			started("s1"),
			...session("s1", "h1"),
			ended("s1", "stopped"),
		);
		const state = stateOf({
			pending: parkedPending("s1", "h1", "Go on."),
			visits: { [NODE.id]: 1 },
		});
		expect(
			entryOf(resumePoint(NODE, state, events, null, RESUME_RULES.agent)),
		).toEqual({
			kind: "reopen",
			stepId: "s1",
			prompt: "Go on.",
		});
		expect(
			entryOf(resumePoint(NODE, state, events, null, RESUME_RULES.call)),
		).toEqual({
			kind: "new",
		});
		const open = logOf(started("s1"), ...session("s1", "h1"));
		expect(
			entryOf(
				resumePoint(
					NODE,
					stateOf({ pending: waitPending("s1", "h1") }),
					open,
					null,
					RESUME_RULES.agent,
				),
			),
		).toEqual({ kind: "continue", stepId: "s1" });
	});
});

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
});

describe("run again from a node", () => {
	const rerun = (
		nodeId: string,
		stepId: string | null,
		prompt: string | null,
	): Ev => ({
		type: "RunResumed",
		payload: {
			nodeId,
			stepId,
			prompt,
			scope: null,
			by: "person",
			action: "rerun",
		},
	});
	const base = [
		started("s1", "a", 1),
		...session("s1", "h-1"),
		ended("s1", "pass"),
		started("s2", "b", 1, null, "decision"),
		ended("s2", "error"),
	];

	test("the first visit of the node continues the session the rerun names, with its prompt", () => {
		const events = logOf(...base, rerun("a", "s1", "Fix it."));
		expect(rerunEntryOf({ id: "a" }, events, null)).toEqual({
			harnessSessionId: "h-1",
			prompt: "Fix it.",
		});
		// Without a prompt: Resume's follow-up.
		expect(
			rerunEntryOf({ id: "a" }, logOf(...base, rerun("a", "s1", null)), null),
		).toEqual({ harnessSessionId: "h-1", prompt: DEFAULT_RESUME_PROMPT });
	});

	test("start fresh: no session, whatever the node says", () => {
		const events = logOf(...base, rerun("a", null, null));
		expect(rerunEntryOf({ id: "a" }, events, null)).toBeNull();
	});

	test("any other visit runs as the node says", () => {
		const events = logOf(...base, rerun("a", "s1", "Fix it."));
		// Another node, a node inside a called flow.
		expect(rerunEntryOf({ id: "b" }, events, null)).toBeUndefined();
		expect(
			rerunEntryOf({ id: "a" }, events, { parentStepId: "s9", itemId: null }),
		).toBeUndefined();
		// A later visit: the rerun walk opened a step already.
		const later = logOf(
			...base,
			rerun("a", "s1", "Fix it."),
			started("s3", "a", 2),
			ended("s3", "pass"),
		);
		expect(rerunEntryOf({ id: "a" }, later, null)).toBeUndefined();
		// A plain resume.
		expect(
			rerunEntryOf({ id: "a" }, logOf(...base, resumed("s1", "Go")), null),
		).toBeUndefined();
	});

	test("the visits are the log's counts: no step is left uncommitted", () => {
		const flow = {
			nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
		} as unknown as Parameters<typeof loggedVisits>[0];
		const events = logOf(...base, started("s3", "a", 2));
		expect(loggedVisits(flow, events, null)).toEqual({ a: 2, b: 1 });
		expect(loggedVisits(flow, events, "a")).toEqual({ a: 1, b: 1 });
	});
});
