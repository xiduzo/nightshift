import { afterEach, beforeEach, expect, test } from "bun:test";
import type { DecisionNode, Flow, FlowNode, WaitNode } from "@nightshift/flows";
import { parseInstant } from "@nightshift/time";
import { foldRun } from "../../log";
import { getRunRow } from "../../log/run-row/run-row";
import { deriveSteps } from "../../read";
import {
	command,
	drive,
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
import { HOLD, inputOf } from "./thread";

/**
 * A Gate or a sleep beside a branch that still works. The working branch
 * walks on while the others wait (`driveGraph` holds them). An answer, a
 * deadline or a signal that comes meanwhile waits only for the step that
 * runs now, not for the whole branch: the drive parks at its next hold
 * (`Walk.yielding`), the Turn comes, and the drive goes on after it.
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

const gate = (deadline?: DecisionNode["deadline"]): DecisionNode => ({
	id: "keep",
	type: "decision",
	position: at,
	prompt: "Keep the branch?",
	options: [{ name: "keep" }, { name: "drop" }],
	by: "person",
	decider: "typesafe",
	...(deadline ? { deadline } : {}),
});

const wait = (until: WaitNode["until"]): WaitNode => ({
	id: "nap",
	type: "wait",
	position: at,
	until,
});

/** Each step of the working branch takes this long. */
const STEP = "sleep 0.4";
/** The working branch: four steps in a row. */
const CHAIN = ["b1", "b2", "b3", "b4"];

/** start → `waiting` (and `also`, if given) and b1 → b2 → b3 → b4 → joined (all). */
function besideChain(waiting: FlowNode, also?: FlowNode): Flow {
	const outcome = (node: FlowNode) =>
		node.type === "decision" ? "keep" : "done";
	const extra = also ? [also] : [];
	return flowOf(
		[
			command("start", "true"),
			waiting,
			...extra,
			...CHAIN.map((id) => command(id, STEP)),
			{ id: "joined", type: "join", position: at, wait: "all" },
		],
		[
			edge("s1", "start", "pass", waiting.id),
			edge("s2", "start", "pass", "b1"),
			...extra.map((node) => edge(`s-${node.id}`, "start", "pass", node.id)),
			edge("w", waiting.id, outcome(waiting) as never, "joined"),
			...extra.map((node) =>
				edge(`j-${node.id}`, node.id, outcome(node) as never, "joined"),
			),
			edge("c1", "b1", "pass", "b2"),
			edge("c2", "b2", "pass", "b3"),
			edge("c3", "b3", "pass", "b4"),
			edge("c4", "b4", "pass", "joined"),
		],
	);
}

const stateOf = async (h: Harness) => foldRun(await h.events());
const stepOf = async (h: Harness, nodeId: string) =>
	deriveSteps(await stateOf(h)).find((s) => s.nodeId === nodeId);

/** A run of `flow` on the test's clock, once `ready` holds while b1 works. */
async function setup(flow: Flow, ready: (h: Harness) => Promise<boolean>) {
	const clock = { now: T0 };
	const now = () => clock.now;
	const h = await startRun(sandbox, flow, { now });
	const runner = testRunner(h, { shared: { now }, overdueSweepMs: 3_600_000 });
	runners.push(runner);
	await runner.take(h.runId, {
		kind: "start",
		prepare: async () => ({
			row: await getRunRow(sandbox.db, h.runId),
			inputs: {},
			stopAt: null,
		}),
	});
	await waitFor(() => ready(h), { timeoutMs: 10_000 });
	return { h, runner, clock };
}

/** The Gate is open, and the chain works on b1 or b2. */
const gateWhileChainWorks = async (h: Harness) =>
	(await stateOf(h)).gates.length === 1 && (await stepOf(h, "b1")) != null;

/** The Gate's step ended while the chain still had steps to go. */
async function gateEndedBeforeChain(h: Harness) {
	await waitFor(async () => (await stepOf(h, "keep"))?.endedAt != null, {
		timeoutMs: 10_000,
	});
	expect((await stepOf(h, "b4"))?.endedAt ?? null).toBeNull();
	expect((await stepOf(h, "keep"))?.outcome).toBe("keep");
}

test("an answer while the branch beside the Gate works is taken at the end of the step that runs now, not of the branch", async () => {
	const { h, runner } = await setup(besideChain(gate()), gateWhileChainWorks);
	const stepId = (await stateOf(h)).gate?.stepId as string;
	expect(runner.isActive(h.runId)).toBe(true);
	expect(
		await runner.take(h.runId, {
			kind: "answer",
			stepId,
			choice: "keep",
			note: "Yes.",
		}),
	).toEqual({ kind: "queued" });
	await gateEndedBeforeChain(h);
	await waitFor(async () => (await stateOf(h)).status === "finished", {
		timeoutMs: 10_000,
	});
});

test("a Gate's deadline while the branch beside it works answers it at the end of the step that runs now", async () => {
	const { h, runner, clock } = await setup(
		besideChain(gate({ minutes: 10, choose: "keep" })),
		gateWhileChainWorks,
	);
	clock.now = T0 + 10 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await gateEndedBeforeChain(h);
	await waitFor(async () => (await stateOf(h)).status === "finished", {
		timeoutMs: 10_000,
	});
});

test("a signal while the branch beside its Wait works wakes the Wait at the end of the step that runs now", async () => {
	const { h, runner } = await setup(
		besideChain(wait({ kind: "signal", name: "go" })),
		async (h) =>
			(await stateOf(h)).waits.length === 1 && (await stepOf(h, "b1")) != null,
	);
	expect(
		await runner.take(h.runId, { kind: "wake", early: true, signal: "go" }),
	).toEqual({ kind: "driving" });
	await waitFor(async () => (await stepOf(h, "nap"))?.endedAt != null, {
		timeoutMs: 10_000,
	});
	expect((await stepOf(h, "b4"))?.endedAt ?? null).toBeNull();
	await waitFor(async () => (await stateOf(h)).status === "finished", {
		timeoutMs: 10_000,
	});
});

test("a Turn that moves nothing does not stop the branch it waited for: the drive goes on", async () => {
	const { h, runner } = await setup(
		besideChain(gate(), {
			...wait({ kind: "duration", minutes: 300 }),
			id: "rest",
		}),
		gateWhileChainWorks,
	);
	// A timer too soon: the drive parks for it, and it changes nothing.
	expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
		kind: "unchanged",
	});
	await waitFor(async () => (await stepOf(h, "b4"))?.endedAt != null, {
		timeoutMs: 10_000,
		label: "the branch to walk on to its last step",
	});
	expect((await stateOf(h)).gates).toHaveLength(1);
});

test("a drive whose holds move nothing parks after one round", async () => {
	const h = await startRun(
		sandbox,
		flowOf(
			[
				command("start", "true"),
				gate(),
				wait({ kind: "signal", name: "go" }),
				{ id: "joined", type: "join", position: at, wait: "all" },
			],
			[
				edge("1", "start", "pass", "keep"),
				edge("2", "start", "pass", "nap"),
				edge("3", "keep", "keep", "joined"),
				edge("4", "nap", "done", "joined"),
			],
		),
	);
	const first = await drive(h, { inputs: {} });
	expect(first.parked.map((p) => p.kind).sort()).toEqual(["gate", "wait"]);
	const snapshot = await h.thread.snapshot();
	const ids =
		snapshot.state.kind === "interrupted"
			? snapshot.state.interrupts.map((i) => i.id)
			: [];
	let checkpoints = 0;
	const put = h.saver.put.bind(h.saver);
	h.saver.put = async (...args) => {
		checkpoints++;
		return put(...args);
	};
	// Each interrupt held: one round, two super-steps, then the drive parks.
	const held = await Promise.race([
		drive(
			h,
			inputOf({
				kind: "resume",
				value: HOLD,
				each: Object.fromEntries(ids.map((id) => [id, HOLD])),
			}),
		),
		Bun.sleep(3_000).then(() => "the hold loop did not end" as const),
	]);
	expect(held).not.toBe("the hold loop did not end");
	expect(checkpoints).toBeLessThanOrEqual(2);
	const run = await stateOf(h);
	expect(run.gates).toHaveLength(1);
	expect(run.waits).toHaveLength(1);
});
