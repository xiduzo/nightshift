import { afterEach, beforeEach, expect, test } from "bun:test";
import type {
	CallNode,
	DecisionNode,
	Flow,
	FlowNode,
	WaitNode,
} from "@nightshift/flows";
import { parseInstant } from "@nightshift/time";
import { foldRun } from "../../log";
import { getRunRow } from "../../log/run-row/run-row";
import { deriveSteps } from "../../read";
import {
	command,
	edge,
	flowOf,
	type Harness,
	MINUTE,
	startRun,
	testRunner,
} from "../../testing/graph";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "../../testing/test-support";
import type { Runner } from "./runner";

/**
 * Two branches wait at once: a Gate and a Wait, two Gates, two Waits, the
 * same inside a Subflow. When one of them is answered or wakes, its branch
 * goes on at once, and the other keeps its wait: it opens no second Gate
 * and sleeps to the same time. The engine holds each interrupt it does not
 * answer (`HOLD`), so the super-step ends. The clock is the test's: a test
 * fires a timer by hand (`take` with a wake), or lets a new runner's
 * `restore` fire it at once. The times are long, so no real timer fires.
 */

let sandbox: Sandbox;
let runners: Runner[];
beforeEach(async () => {
	sandbox = await createSandbox();
	runners = [];
});
afterEach(async () => {
	for (const runner of runners) await runner.release();
	await sandbox.cleanup();
});

const T0 = parseInstant("2026-10-26T22:00:00");
const at = { x: 0, y: 0 };

const gate = (
	id = "keep",
	deadline?: DecisionNode["deadline"],
): DecisionNode => ({
	id,
	type: "decision",
	position: at,
	prompt: "Keep the branch?",
	options: [{ name: "keep" }, { name: "drop" }],
	by: "person",
	decider: "typesafe",
	...(deadline ? { deadline } : {}),
});

const wait = (until: WaitNode["until"], id = "nap"): WaitNode => ({
	id,
	type: "wait",
	position: at,
	until,
});

const NAP = { kind: "duration", minutes: 100 } as const;
const LONG_NAP = { kind: "duration", minutes: 300 } as const;
const SIGNAL = { kind: "signal", name: "go" } as const;

/** The outcome a node of these flows goes on with: a Gate's answer, a Wait's `done`, a Subflow's `pass`. */
const outcomeOf = (node: FlowNode) =>
	node.type === "decision" ? "keep" : node.type === "wait" ? "done" : "pass";

/**
 * start → `left` and `right` → joined (all). Each branch has a step after
 * its first node, so a branch that goes on shows it at once.
 */
const beside = (left: FlowNode, right: FlowNode): Flow =>
	flowOf(
		[
			command("start", "true"),
			left,
			right,
			command(`after_${left.id}`, "true"),
			command(`after_${right.id}`, "true"),
			{ id: "joined", type: "join", position: at, wait: "all" },
		],
		[
			edge("1", "start", "pass", left.id),
			edge("2", "start", "pass", right.id),
			edge("3", left.id, outcomeOf(left), `after_${left.id}`),
			edge("4", right.id, outcomeOf(right), `after_${right.id}`),
			edge("5", `after_${left.id}`, "pass", "joined"),
			edge("6", `after_${right.id}`, "pass", "joined"),
		],
	);

/** A run of `flow` on a clock the test moves, once it waits at both branches. */
async function setup(
	flow: Flow,
	options: {
		flows?: Record<string, Flow>;
		parked: (h: Harness) => Promise<boolean>;
	},
) {
	const clock = { now: T0 };
	const now = () => clock.now;
	const h = await startRun(sandbox, flow, {
		now,
		...(options.flows ? { flows: options.flows } : {}),
	});
	const runner = testRunner(h, { shared: { now } });
	runners.push(runner);
	await runner.take(h.runId, {
		kind: "start",
		prepare: async () => ({
			row: await getRunRow(sandbox.db, h.runId),
			inputs: {},
			stopAt: null,
		}),
	});
	await waitFor(
		async () => !runner.isActive(h.runId) && (await options.parked(h)),
	);
	return { h, runner, clock };
}

const stateOf = async (h: Harness) => foldRun(await h.events());
const stepOf = async (h: Harness, nodeId: string) =>
	deriveSteps(await stateOf(h)).find((s) => s.nodeId === nodeId);
const count = async (h: Harness, type: string) =>
	(await h.events()).filter((e) => e.type === type).length;

/** A Gate is open and a step sleeps. */
const gateAndSleep = async (h: Harness) => {
	const run = await stateOf(h);
	return run.gates.length === 1 && run.waits.length === 1;
};

/** The branch of `nodeId` went on: its step and the step after it ended. */
async function wentOn(h: Harness, runner: Runner, nodeId: string) {
	await waitFor(
		async () =>
			!runner.isActive(h.runId) &&
			(await stepOf(h, `after_${nodeId}`))?.endedAt != null,
	);
	expect((await stepOf(h, nodeId))?.endedAt).not.toBeNull();
}

/** The Wait's branch went on, the Gate is still open once, and the run waits at it. */
async function napDoneGateOpen(h: Harness, runner: Runner) {
	await wentOn(h, runner, "nap");
	expect((await stepOf(h, "nap"))?.outcome).toBe("done");
	const run = await stateOf(h);
	expect(run.status).toBe("waiting");
	expect(run.gates.map((g) => g.nodeId)).toEqual(["keep"]);
	expect(await count(h, "GateOpened")).toBe(1);
}

/** A person answers the Gate at `nodeId`. */
async function answer(h: Harness, runner: Runner, nodeId = "keep") {
	const gate = (await stateOf(h)).gates.find((g) => g.nodeId === nodeId);
	await runner.take(h.runId, {
		kind: "answer",
		stepId: gate?.stepId as string,
		choice: "keep",
		note: "Yes.",
	});
}

/** The run went past the Join and finished, with the person's answer on the Gate. */
async function finished(h: Harness) {
	await waitFor(async () => (await stateOf(h)).status === "finished");
	expect((await stepOf(h, "keep"))?.outputs).toMatchObject({
		outcome: "keep",
		note: "Yes.",
	});
	expect((await stepOf(h, "joined"))?.endedAt).not.toBeNull();
	expect(await count(h, "GateOpened")).toBe(1);
}

test("a Wait beside a Gate with no deadline wakes at its time, and its branch goes on while the Gate stays open", async () => {
	const { h, runner, clock } = await setup(beside(gate(), wait(NAP)), {
		parked: gateAndSleep,
	});
	// A timer before the Wait's time changes nothing.
	clock.now = T0 + 50 * MINUTE;
	expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
		kind: "unchanged",
	});
	expect((await stepOf(h, "nap"))?.endedAt).toBeNull();
	clock.now = T0 + 100 * MINUTE;
	expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
		kind: "driving",
	});
	await napDoneGateOpen(h, runner);
	expect(await count(h, "WaitStarted")).toBe(1);
	await answer(h, runner);
	await finished(h);
});

test("a Wait beside a Gate whose deadline comes later: the Wait wakes first, then the deadline answers the Gate", async () => {
	const { h, runner, clock } = await setup(
		beside(gate("keep", { minutes: 300, choose: "keep" }), wait(NAP)),
		{ parked: gateAndSleep },
	);
	clock.now = T0 + 100 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await napDoneGateOpen(h, runner);
	// A timer before the deadline changes nothing.
	clock.now = T0 + 200 * MINUTE;
	expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
		kind: "unchanged",
	});
	expect((await stateOf(h)).status).toBe("waiting");
	clock.now = T0 + 300 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await waitFor(async () => (await stateOf(h)).status === "finished");
	expect((await stepOf(h, "keep"))?.outputs).toMatchObject({
		outcome: "keep",
		note: 'Nobody answered by the deadline, so Night Shift chose "keep".',
	});
});

test("a Gate whose deadline comes before the Wait beside it: the deadline answers the Gate, its branch goes on, and the Wait wakes at its time", async () => {
	const { h, runner, clock } = await setup(
		beside(gate("keep", { minutes: 50, choose: "keep" }), wait(NAP)),
		{ parked: gateAndSleep },
	);
	clock.now = T0 + 50 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await wentOn(h, runner, "keep");
	expect((await stepOf(h, "keep"))?.outcome).toBe("keep");
	expect((await stepOf(h, "nap"))?.endedAt).toBeNull();
	expect((await stateOf(h)).status).toBe("sleeping");
	expect(await count(h, "WaitStarted")).toBe(1);
	clock.now = T0 + 100 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await waitFor(async () => (await stateOf(h)).status === "finished");
	expect((await stepOf(h, "nap"))?.outcome).toBe("done");
});

for (const [who, wake] of [
	["a person", { kind: "wake", early: true, signal: "go" }],
	[
		"a webhook",
		{ kind: "wake", early: true, signal: "go", data: { ref: "main" } },
	],
] as const)
	test(`a signal from ${who} wakes the Wait beside an open Gate at once; the answer later still reaches the Gate`, async () => {
		const { h, runner } = await setup(beside(gate(), wait(SIGNAL)), {
			parked: gateAndSleep,
		});
		expect(await runner.take(h.runId, wake)).toEqual({ kind: "driving" });
		await napDoneGateOpen(h, runner);
		const ended = (await h.events()).find((e) => e.type === "WaitEnded");
		expect(ended?.payload).toEqual({ early: true, signal: "go" });
		await answer(h, runner);
		await finished(h);
	});

test("a restart while the Gate and the Wait both wait: a new runner sets the next timer from the log, and each fires in turn", async () => {
	const { h, runner, clock } = await setup(
		beside(gate("keep", { minutes: 300, choose: "keep" }), wait(NAP)),
		{ parked: gateAndSleep },
	);
	await runner.release();
	// The Wait's time passed while Night Shift was down: it wakes at once.
	clock.now = T0 + 100 * MINUTE;
	const next = testRunner(h, { shared: { now: () => clock.now } });
	runners.push(next);
	next.restore(h.runId, await stateOf(h));
	await napDoneGateOpen(h, next);
	await next.release();
	// Down again past the deadline: the Gate takes its option at once.
	clock.now = T0 + 300 * MINUTE;
	const last = testRunner(h, { shared: { now: () => clock.now } });
	runners.push(last);
	last.restore(h.runId, await stateOf(h));
	await waitFor(async () => (await stateOf(h)).status === "finished");
	expect((await stepOf(h, "keep"))?.outcome).toBe("keep");
	expect(await count(h, "GateOpened")).toBe(1);
});

test("two Gates: the answer to one moves its branch on at once, and the other Gate stays open once and takes its answer later", async () => {
	const { h, runner } = await setup(beside(gate("keep"), gate("ship")), {
		parked: async (h) => (await stateOf(h)).gates.length === 2,
	});
	await answer(h, runner, "keep");
	await wentOn(h, runner, "keep");
	const run = await stateOf(h);
	expect(run.status).toBe("waiting");
	expect(run.gates.map((g) => g.nodeId)).toEqual(["ship"]);
	expect(await count(h, "GateOpened")).toBe(2);
	await answer(h, runner, "ship");
	await waitFor(async () => (await stateOf(h)).status === "finished");
	expect((await stepOf(h, "ship"))?.outcome).toBe("keep");
	expect(await count(h, "GateOpened")).toBe(2);
});

test("two Waits: the first wakes at its time and its branch goes on, and the second sleeps on to its own time", async () => {
	const { h, runner, clock } = await setup(
		beside(wait(NAP, "nap"), wait(LONG_NAP, "rest")),
		{ parked: async (h) => (await stateOf(h)).waits.length === 2 },
	);
	clock.now = T0 + 100 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await wentOn(h, runner, "nap");
	expect((await stepOf(h, "rest"))?.endedAt).toBeNull();
	const run = await stateOf(h);
	expect(run.status).toBe("sleeping");
	expect(run.waits.map((w) => w.payload.until)).toEqual([T0 + 300 * MINUTE]);
	expect(await count(h, "WaitStarted")).toBe(2);
	clock.now = T0 + 300 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await waitFor(async () => (await stateOf(h)).status === "finished");
});

/** A Subflow whose body waits at a Gate and a Wait on two branches. */
const BODY = flowOf(
	[
		command("start", "true"),
		gate(),
		wait(SIGNAL),
		command("after_nap", "true"),
		{ id: "joined", type: "join", position: at, wait: "all" },
	],
	[
		edge("1", "start", "pass", "keep"),
		edge("2", "start", "pass", "nap"),
		edge("3", "nap", "done", "after_nap"),
		edge("4", "keep", "keep", "joined"),
		edge("5", "after_nap", "pass", "joined"),
	],
);
const call = (id: string): CallNode => ({
	id,
	type: "call",
	position: at,
	flow: "body",
	inputs: {},
});

test("inside a Subflow: a signal wakes the Wait beside an open Gate at once, and the answer later reaches the Gate", async () => {
	const { h, runner } = await setup(flowOf([call("sub")]), {
		flows: { body: BODY },
		parked: gateAndSleep,
	});
	expect(
		await runner.take(h.runId, { kind: "wake", early: true, signal: "go" }),
	).toEqual({ kind: "driving" });
	await napDoneGateOpen(h, runner);
	await answer(h, runner);
	await waitFor(async () => (await stateOf(h)).status === "finished");
	expect((await stepOf(h, "keep"))?.outcome).toBe("keep");
	expect(await count(h, "GateOpened")).toBe(1);
});

test("a Wait beside a Subflow that waits at a Gate wakes only after the answer: a signal before it is refused and changes nothing", async () => {
	const inner = flowOf([gate()]);
	const { h, runner } = await setup(beside(call("sub"), wait(SIGNAL)), {
		flows: { body: inner },
		parked: gateAndSleep,
	});
	const before = (await h.events()).length;
	await expect(
		runner.take(h.runId, { kind: "wake", early: true, signal: "go" }),
	).rejects.toThrow(
		"Answer the Gate in the Subflow beside this step first. Then try again.",
	);
	expect((await h.events()).length).toBe(before);
	await answer(h, runner);
	await wentOn(h, runner, "sub");
	expect((await stateOf(h)).status).toBe("sleeping");
	await runner.take(h.runId, { kind: "wake", early: true, signal: "go" });
	await waitFor(async () => (await stateOf(h)).status === "finished");
});

test("a sleep that a Subflow's Gate holds back hides no timer: the Gate's deadline still answers it, then the sleep wakes", async () => {
	const inner = flowOf([gate("keep", { minutes: 300, choose: "keep" })]);
	const { h, runner, clock } = await setup(beside(call("sub"), wait(NAP)), {
		flows: { body: inner },
		parked: gateAndSleep,
	});
	// The sleep is due, but the Gate holds it back: nothing changes.
	clock.now = T0 + 100 * MINUTE;
	expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
		kind: "unchanged",
	});
	expect(await count(h, "WaitEnded")).toBe(0);
	clock.now = T0 + 300 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await waitFor(async () => (await stateOf(h)).status === "finished");
	expect((await stepOf(h, "keep"))?.outputs).toMatchObject({
		outcome: "keep",
		note: 'Nobody answered by the deadline, so Night Shift chose "keep".',
	});
	expect((await stepOf(h, "nap"))?.outcome).toBe("done");
});

test("a sleep that a Subflow's Gate holds back hides no timer: a sleep in another Subflow wakes at its own time", async () => {
	const flow = flowOf(
		[
			command("start", "true"),
			call("sub"),
			wait(NAP),
			{ ...call("later"), flow: "later" },
			{ id: "joined", type: "join", position: at, wait: "all" },
		],
		[
			edge("1", "start", "pass", "sub"),
			edge("2", "start", "pass", "nap"),
			edge("3", "start", "pass", "later"),
			edge("4", "sub", "pass", "joined"),
			edge("5", "nap", "done", "joined"),
			edge("6", "later", "pass", "joined"),
		],
	);
	const { h, runner, clock } = await setup(flow, {
		flows: { body: flowOf([gate()]), later: flowOf([wait(LONG_NAP, "rest")]) },
		parked: async (h) => {
			const run = await stateOf(h);
			return run.gates.length === 1 && run.waits.length === 2;
		},
	});
	clock.now = T0 + 100 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	clock.now = T0 + 300 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await waitFor(
		async () =>
			!runner.isActive(h.runId) && (await stepOf(h, "rest"))?.endedAt != null,
	);
	expect((await stepOf(h, "rest"))?.outcome).toBe("done");
	expect((await stepOf(h, "nap"))?.endedAt).toBeNull();
	await answer(h, runner);
	await waitFor(async () => (await stateOf(h)).status === "finished");
});
