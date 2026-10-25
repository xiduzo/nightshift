import { describe, expect, test } from "bun:test";
import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
	Scope,
} from "../log/events";
import { deriveSteps } from "../read/derive-steps";
import {
	commitVisit,
	frontOf,
	heldStep,
	holdEnded,
	isDone,
	latestFront,
	loggedVisits,
	positionOf,
	reenteredNode,
	takeBackVisit,
} from "./run-position";
import type { Pending, RunStateValues } from "./state";

/**
 * The run position as tables: what the checkpoint committed against what
 * the log started, the step a node holds, the front of the walk, and the
 * visits a re-entry seeds. The log is built in memory (the module only
 * reads). The crash test (`crash.test.ts`) drives the same rule through a
 * real run, crashed at every write.
 */

/** An in-memory log: events get their seq in order. */
function logOf(
	...entries: {
		[T in EngineEventType]: {
			type: T;
			payload: EnginePayloads[T];
			stepId?: string;
		};
	}[EngineEventType][]
): LoggedEvent[] {
	return entries.map(
		(e, i) =>
			({
				seq: i + 1,
				runId: "run",
				stepId: e.stepId ?? null,
				sessionId: null,
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
): Ev => ({
	type: "StepStarted",
	stepId,
	payload: {
		nodeId,
		nodeType: "agent",
		visit,
		transcriptPath: `/t/${stepId}.ndjson`,
		logPath: null,
		scope,
	},
});
const ended = (stepId: string, outcome = "pass"): Ev => ({
	type: "StepEnded",
	stepId,
	payload: { outcome, outputs: { outcome }, error: null },
});
const runEnded = (status: "finished" | "stopped" | "interrupted"): Ev => ({
	type: "RunEnded",
	payload: { status, reason: null },
});
const edgeTaken = (
	from: string,
	to: string,
	scope: Scope | null = null,
): Ev => ({
	type: "EdgeTaken",
	payload: { edgeId: `${from}-${to}`, from, to, outcome: "pass", scope },
});

const A = { id: "a" };
const body: Scope = { parentStepId: "c1", itemId: null };

const stateOf = (
	over: Partial<Pick<RunStateValues, "pending" | "loops" | "visits">> = {},
): Pick<RunStateValues, "pending" | "loops" | "visits"> => ({
	pending: null,
	loops: {},
	visits: {},
	...over,
});

describe("the rule: the log counts one more visit than the checkpoint for a step that did not commit", () => {
	const twoVisits = logOf(
		started("s1", "a", 1),
		ended("s1"),
		started("s2", "a", 2),
	);
	test.each([
		["nothing committed: the latest step", 0, "s2"],
		["the first visit committed: the latest step", 1, "s2"],
		["both committed: none", 2, null],
		["more committed than logged (a seed): none", 3, null],
	])("%s", (_, committed, expected) => {
		const at = positionOf(
			stateOf({ visits: { a: committed } }),
			twoVisits,
			null,
		);
		expect(at.uncommitted(A)?.id ?? null).toBe(expected);
	});

	test("a commit of the step's visit leaves nothing uncommitted", () => {
		const { visits } = commitVisit(A, 2);
		expect(visits).toEqual({ a: 2 });
		expect(
			positionOf(stateOf({ visits }), twoVisits, null).uncommitted(A),
		).toBeNull();
	});

	test("each scope counts its own steps, and numbers its own visits", () => {
		const events = logOf(
			started("c1", "c", 1),
			started("s1", "a", 1, body),
			ended("s1"),
			started("s2", "a", 2, body),
		);
		const top = positionOf(stateOf(), events, null);
		expect(top.uncommitted(A)).toBeNull();
		expect(top.latest(A)).toBeNull();
		expect(top.nextVisit(A)).toBe(1);
		const inner = positionOf(stateOf({ visits: { a: 1 } }), events, body);
		expect(inner.uncommitted(A)?.id).toBe("s2");
		expect(inner.latest(A)?.id).toBe("s2");
		expect(inner.nextVisit(A)).toBe(3);
	});
});

describe("the step a node holds", () => {
	const parked: Pending = {
		kind: "parked",
		stepId: "s1",
		nodeId: "a",
		visit: 1,
		harnessSessionId: null,
		prompt: null,
		status: "stopped",
		reason: null,
	};
	const events = logOf(started("s1", "a", 1), ended("s1"));

	test("only its own, with the step as the log has it", () => {
		const at = positionOf(stateOf({ pending: parked }), events, null);
		expect(at.held(A)?.pending).toBe(parked);
		expect(at.held(A)?.step?.id).toBe("s1");
		expect(at.held({ id: "b" })).toBeNull();
		expect(heldStep({ pending: parked }, "a")).toBe(parked);
		expect(heldStep({ pending: parked }, "b")).toBeNull();
		expect(heldStep({ pending: null }, "a")).toBeNull();
	});

	test("a park before the step started holds no step", () => {
		const before = { ...parked, stepId: null };
		const at = positionOf(stateOf({ pending: before }), events, null);
		expect(at.held(A)).toEqual({ pending: before, step: null });
	});

	test("a loop is mid-way while its cursor is set", () => {
		expect(
			positionOf(stateOf({ loops: { a: { index: 1 } } }), [], null).looping(A),
		).toBe(true);
		expect(
			positionOf(stateOf({ loops: { a: null } }), [], null).looping(A),
		).toBe(false);
	});

	test("a loop's cursor is behind when the log ended an element it never committed", () => {
		const item = (id: string) => ({ id, value: id, title: id, url: null });
		const events = logOf(
			started("s1", "a"),
			{
				type: "ItemStarted",
				stepId: "s1",
				payload: {
					item: item("x"),
					index: 1,
					branch: null,
					baseBranch: null,
					inputs: {},
				},
			},
			{
				type: "ItemEnded",
				stepId: "s1",
				payload: { itemId: "x", state: "done", reason: null, outputs: {} },
			},
		);
		expect(positionOf(stateOf(), events, null).cursorBehind(A)).toBe(1);
		expect(
			positionOf(
				stateOf({ loops: { a: { index: 1 } } }),
				events,
				null,
			).cursorBehind(A),
		).toBeNull();
	});

	test("a held wait or Gate is stale once the log ended its step", () => {
		const gate: Pending = {
			kind: "gate",
			stepId: "s1",
			nodeId: "a",
			visit: 1,
			question: "Ship it?",
			choices: [],
		};
		expect(holdEnded(logOf(started("s1", "a")), gate)).toBe(false);
		expect(
			holdEnded(logOf(started("s1", "a"), ended("s1", "stopped")), gate),
		).toBe(true);
	});
});

describe("a step that is done: it ended on its own, and the commit after it never landed", () => {
	const doneAt = (
		state: Partial<Pick<RunStateValues, "pending" | "loops" | "visits">>,
		...events: Ev[]
	) => positionOf(stateOf(state), logOf(...events), null).done(A);

	test("an uncommitted step that ended on its own is done, with the edge the walk took after it", () => {
		expect(doneAt({}, started("s1", "a"), ended("s1"))).toMatchObject({
			step: { id: "s1" },
			ended: { outcome: "pass" },
			edge: null,
		});
		expect(
			doneAt(
				{},
				started("s1", "a"),
				ended("s1"),
				edgeTaken("a", "b"),
				runEnded("interrupted"),
			),
		).toMatchObject({ step: { id: "s1" }, edge: { to: "b" } });
	});

	test.each([
		["it runs", [started("s1", "a")]],
		["a stop ended it", [started("s1", "a"), ended("s1", "stopped")]],
		[
			"it failed, or ran past its time",
			[started("s1", "a"), ended("s1", "error")],
		],
		[
			"a daemon death ended it",
			[started("s1", "a"), ended("s1", "interrupted")],
		],
		[
			"the run finished after it: a resume reopens it on purpose",
			[started("s1", "a"), ended("s1"), runEnded("finished")],
		],
	])("not done when %s", (_, events) => {
		expect(doneAt({}, ...(events as Ev[]))).toBeNull();
	});

	test("a committed step is not done; a held wait or a loop that the log ended is", () => {
		const log = [started("s1", "a"), ended("s1")];
		expect(doneAt({ visits: { a: 1 } }, ...log)).toBeNull();
		const wait: Pending = {
			kind: "wait",
			stepId: "s1",
			nodeId: "a",
			visit: 1,
			reason: "usage-limit",
			until: 2_000,
			message: "Waits.",
			streak: { count: 1, since: 1_000 },
			session: null,
		};
		expect(doneAt({ pending: wait, visits: { a: 1 } }, ...log)?.step.id).toBe(
			"s1",
		);
		expect(
			doneAt({ loops: { a: { index: 1 } }, visits: { a: 1 } }, ...log)?.step.id,
		).toBe("s1");
		// A loop whose step is still open goes on.
		expect(
			doneAt(
				{ loops: { a: { index: 1 } }, visits: { a: 1 } },
				started("s1", "a"),
			),
		).toBeNull();
	});

	test("a parked step's end is the checkpoint's own: not done", () => {
		const parked: Pending = {
			kind: "parked",
			stepId: "s1",
			nodeId: "a",
			visit: 1,
			harnessSessionId: null,
			prompt: null,
			status: "failed",
			reason: null,
		};
		expect(
			doneAt({ pending: parked }, started("s1", "a"), ended("s1", "fail")),
		).toBeNull();
	});

	test("isDone asks the same of any step the log has", () => {
		const events = logOf(started("s1", "a"), ended("s1"));
		const [step] = deriveSteps(events);
		if (!step) throw new Error("no step");
		expect(isDone(events, step)).toBe(true);
		const finished = logOf(
			started("s1", "a"),
			ended("s1"),
			runEnded("finished"),
		);
		expect(isDone(finished, step)).toBe(false);
	});
});

describe("the front of the walk", () => {
	test("the last step, and the edge the walk took after it", () => {
		const atStep = logOf(started("s1", "a"), ended("s1"));
		expect(frontOf(atStep, null)).toMatchObject({
			last: { id: "s1" },
			movedOn: null,
		});
		const movedOn = logOf(started("s1", "a"), ended("s1"), edgeTaken("a", "b"));
		expect(frontOf(movedOn, null)).toMatchObject({
			last: { id: "s1" },
			movedOn: { payload: { to: "b" } },
		});
	});

	test("one scope's front, or the latest over every scope", () => {
		const events = logOf(
			started("c1", "c"),
			started("s1", "a", 1, body),
			ended("s1"),
			edgeTaken("a", "b", body),
		);
		expect(frontOf(events, null)).toMatchObject({
			last: { id: "c1" },
			movedOn: null,
		});
		expect(latestFront(events)).toMatchObject({
			last: { id: "s1" },
			movedOn: { payload: { to: "b" } },
		});
	});

	test("a re-entry reopens the last top-level node the walk did not move on from", () => {
		expect(reenteredNode(logOf())).toBeNull();
		expect(reenteredNode(logOf(started("s1", "a"), ended("s1")))).toBe("a");
		expect(
			reenteredNode(
				logOf(started("s1", "a"), ended("s1"), edgeTaken("a", "b")),
			),
		).toBeNull();
		// A step in a called flow: its caller is the top-level node.
		expect(
			reenteredNode(logOf(started("c1", "c"), started("s1", "a", 1, body))),
		).toBe("c");
	});
});

describe("the re-entry seed", () => {
	const flow = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] };
	const events = logOf(
		started("s1", "a", 1),
		ended("s1"),
		started("s2", "b", 1),
		ended("s2"),
		started("s3", "a", 2),
	);

	test("the log's counts commit every step; the reopened node's last one stays uncommitted", () => {
		expect(loggedVisits(flow, events, null)).toEqual({ a: 2, b: 1 });
		const visits = loggedVisits(flow, events, "a");
		expect(visits).toEqual({ a: 1, b: 1 });
		const at = positionOf(stateOf({ visits }), events, null);
		expect(at.uncommitted(A)?.id).toBe("s3");
		expect(at.uncommitted({ id: "b" })).toBeNull();
	});

	test("a checkpoint's last visit is taken back, so that step is the one uncommitted", () => {
		const values = { visits: { a: 2, b: 1 } };
		const seed = takeBackVisit(values, "a");
		expect(seed).toEqual({ visits: { a: 1 } });
		const at = positionOf(
			stateOf({ visits: { ...values.visits, ...seed.visits } }),
			events,
			null,
		);
		expect(at.uncommitted(A)?.id).toBe("s3");
		expect(takeBackVisit(values, null)).toEqual({});
		expect(takeBackVisit({ visits: {} }, "a")).toEqual({});
	});
});
