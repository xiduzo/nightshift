import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { DecisionNode, Flow } from "@nightshift/flows";
import { parseInstant } from "@nightshift/time";
import { foldRun } from "../../log";
import { getRunRow } from "../../log/run-row/run-row";
import { deriveSteps, parseCalledFlows, parseRunFlow } from "../../read";
import { RunRefusal } from "../../run-status";
import { wireRecovery } from "../../runs";
import { runnerTurns } from "../../runs/walk/adapters/out/runner-turns";
import { defaultRunSettings } from "../../settings/settings";
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
 * An answer that comes while a drive walks a branch beside its Gate waits
 * for the drive's next hold (`AnswerQueued`). It is a fact: the Gate shows
 * it as on its way and takes no second answer, a new daemon passes it on,
 * a full run cap does not hold it back, and when the Gate no longer takes
 * it a warning on the Gate's step says why.
 */

let sandbox: Sandbox;
let runners: Runner[];
let quiet: ReturnType<typeof spyOn> | null = null;
beforeEach(async () => {
	sandbox = await createSandbox();
	runners = [];
});
afterEach(async () => {
	for (const runner of runners) await runner.release();
	quiet?.mockRestore();
	quiet = null;
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

/** start → keep (a Gate) and b1 → b2 → b3 → joined (all). */
const besideChain = (keep: DecisionNode = gate()): Flow =>
	flowOf(
		[
			command("start", "true"),
			keep,
			command("b1", "sleep 0.4"),
			command("b2", "sleep 0.4"),
			command("b3", "sleep 0.4"),
			{ id: "joined", type: "join", position: at, wait: "all" },
		],
		[
			edge("1", "start", "pass", "keep"),
			edge("2", "start", "pass", "b1"),
			edge("3", "keep", "keep", "joined"),
			edge("4", "b1", "pass", "b2"),
			edge("5", "b2", "pass", "b3"),
			edge("6", "b3", "pass", "joined"),
		],
	);

const stateOf = async (h: Harness, runId = h.runId) =>
	foldRun((await h.log.events(runId)) as never);
const stepOf = async (h: Harness, nodeId: string) =>
	deriveSteps(await stateOf(h)).find((s) => s.nodeId === nodeId);
const typesOf = async (h: Harness) => (await h.events()).map((e) => e.type);

/** A runner over `h` on the test's clock, with a run cap of `cap`. */
function runnerOf(h: Harness, clock: { now: number }, cap = 4): Runner {
	const runner = testRunner(h, {
		overdueSweepMs: 3_600_000,
		shared: {
			now: () => clock.now,
			settings: () => ({ ...defaultRunSettings(), maxConcurrentRuns: cap }),
		},
	});
	runners.push(runner);
	return runner;
}

/**
 * Another run that waits for a slot in the cap queue: a stopped run that
 * a person resumes on a full cap.
 */
async function waitsForSlot(h: Harness, runner: Runner): Promise<void> {
	const other = (await startRun(sandbox, flowOf([command("x", "true")]))).runId;
	await h.log.append({
		type: "RunEnded",
		runId: other,
		payload: {
			status: "stopped",
			reason: null,
			endReason: "stopped_by_person",
		},
	});
	expect(
		await runner.take(
			other,
			{ kind: "resume", by: "person" },
			{ whenFull: "queue" },
		),
	).toEqual({ kind: "queued" });
}

const start = (runner: Runner, runId: string) =>
	runner.take(runId, {
		kind: "start",
		prepare: async () => ({
			row: await getRunRow(sandbox.db, runId),
			inputs: {},
			stopAt: null,
		}),
	});

/** A run beside a working branch, its Gate open while b1 works. */
async function setup(options: { cap?: number; keep?: DecisionNode } = {}) {
	const clock = { now: T0 };
	const h = await startRun(sandbox, besideChain(options.keep), {
		now: () => clock.now,
	});
	const runner = runnerOf(h, clock, options.cap);
	await start(runner, h.runId);
	await waitFor(
		async () =>
			(await stateOf(h)).gates.length === 1 && runner.isActive(h.runId),
		{ timeoutMs: 10_000 },
	);
	const stepId = (await stateOf(h)).gate?.stepId as string;
	const answer = (note: string, choice = "keep") =>
		runner.take(h.runId, { kind: "answer", stepId, choice, note });
	return { h, runner, clock, stepId, answer };
}

test("an answer while a branch works is a fact: the Gate shows it on its way, and takes it at the drive's next hold", async () => {
	const { h, answer } = await setup();
	expect(await answer("First.")).toEqual({ kind: "queued" });
	expect(await typesOf(h)).toContain("AnswerQueued");
	expect((await stateOf(h)).gate?.answerQueued).toBe(true);
	await waitFor(async () => (await stepOf(h, "keep"))?.endedAt != null, {
		timeoutMs: 10_000,
	});
	expect((await stepOf(h, "keep"))?.outputs).toMatchObject({
		outcome: "keep",
		note: "First.",
	});
});

test("a second answer while the first waits is refused at once, and the first one counts", async () => {
	const { h, answer } = await setup();
	await answer("First.");
	await expect(answer("Second.", "drop")).rejects.toThrow(
		"This Gate has its answer. The run continues with it.",
	);
	await waitFor(async () => (await stateOf(h)).status === "finished", {
		timeoutMs: 10_000,
	});
	expect((await stepOf(h, "keep"))?.outputs).toMatchObject({
		outcome: "keep",
		note: "First.",
	});
});

test("a full run cap does not hold back an answer that waits: the drive keeps its slot for it", async () => {
	const { h, runner, answer } = await setup({ cap: 1 });
	await waitsForSlot(h, runner);
	await answer("First.");
	await waitFor(async () => (await stepOf(h, "keep"))?.endedAt != null, {
		timeoutMs: 10_000,
		label: "the Gate to take the answer",
	});
	expect((await stepOf(h, "keep"))?.outcome).toBe("keep");
	expect(
		(await h.events()).some(
			(e) =>
				e.type === "RunWarned" &&
				(e.payload as { kind: string }).kind === "answer-dropped",
		),
	).toBe(false);
});

test("a full run cap does not stop the branch after a Turn that moved nothing", async () => {
	const { h, runner } = await setup({
		cap: 1,
		keep: gate({ minutes: 300, choose: "keep" }),
	});
	await waitsForSlot(h, runner);
	// A timer before the deadline: it moves nothing.
	expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
		kind: "unchanged",
	});
	await waitFor(async () => (await stepOf(h, "b3"))?.endedAt != null, {
		timeoutMs: 10_000,
		label: "the branch to walk on to its last step",
	});
});

test("an answer that waits when Night Shift stops is passed on by the next one's startup recovery", async () => {
	quiet = spyOn(console, "error").mockImplementation(() => {});
	const { h, runner, clock, answer } = await setup();
	await answer("First.");
	await runner.release();
	// The next daemon: its startup recovery, over a runner of its own.
	const next = runnerOf(h, clock);
	const recovery = wireRecovery({
		openWork: {
			db: sandbox.db,
			log: h.log,
			bus: h.deps.shared.bus,
			flowOf: parseRunFlow,
			calledFlowsOf: parseCalledFlows,
			runHolds: {
				ended: async () => {},
				notContinuing: async () => {},
				resuming: async () => {},
			},
		},
		waits: { db: sandbox.db, log: h.log },
		facts: h.log,
		turns: runnerTurns(next),
		holds: { start: (_spaceId, work) => work() },
		openRun: async (_actor, { runId }) => ({
			run: await h.log.row(runId),
			walkedHere: true,
		}),
		now: () => clock.now,
		settings: () => ({
			...defaultRunSettings(),
			resumeInterruptedRuns: false,
		}),
		schedulerOn: true,
		resumeGraceMs: 0,
	});
	await recovery.recoverRuns();
	await waitFor(async () => (await stepOf(h, "keep"))?.endedAt != null, {
		timeoutMs: 10_000,
		label: "the new daemon to pass the answer on",
	});
	expect((await stepOf(h, "keep"))?.outputs).toMatchObject({
		outcome: "keep",
		note: "First.",
	});
});

test("a deadline that comes while an answer waits leaves the Gate to that answer", async () => {
	const { h, runner, clock, answer } = await setup({
		keep: gate({ minutes: 10, choose: "drop" }),
	});
	expect(await answer("In time.")).toEqual({ kind: "queued" });
	clock.now = T0 + 10 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await waitFor(async () => (await stepOf(h, "keep"))?.endedAt != null, {
		timeoutMs: 10_000,
	});
	expect((await stepOf(h, "keep"))?.outputs).toMatchObject({
		outcome: "keep",
		note: "In time.",
	});
});

test("an answer that waits and that the Gate then refuses: a warning on the Gate's step says why", async () => {
	const { h, runner, stepId } = await setup();
	let looks = 0;
	// The caller's check takes the answer now, and refuses it in its Turn.
	const check = () => {
		if (looks++ > 0)
			throw new RunRefusal("gate-closed", "Someone else answered it.");
	};
	expect(
		await runner.take(
			h.runId,
			{ kind: "answer", stepId, choice: "keep", note: "Mine." },
			{ check },
		),
	).toEqual({ kind: "queued" });
	await waitFor(
		async () =>
			(await stateOf(h)).warnings.some(
				(w) => w.payload.kind === "answer-dropped",
			),
		{ timeoutMs: 10_000, label: "the warning" },
	);
	const warning = (await stateOf(h)).warnings.find(
		(w) => w.payload.kind === "answer-dropped",
	);
	expect(warning?.payload.message).toBe(
		"Your answer did not reach the Gate. Someone else answered it.",
	);
	expect(warning?.stepId).toBe(stepId);
	// The Gate waits again, and takes the next answer.
	await waitFor(async () => !runner.isActive(h.runId), { timeoutMs: 10_000 });
	expect((await stateOf(h)).gate?.answerQueued).toBe(false);
});

test("a stop while an answer waits: a warning on the Gate's step says the run stopped first", async () => {
	const { h, runner, answer } = await setup();
	await answer("First.");
	await runner.take(h.runId, { kind: "stop", by: "person" });
	const warning = (await stateOf(h)).warnings.find(
		(w) => w.payload.kind === "answer-dropped",
	);
	expect(warning?.payload.message).toBe(
		"Your answer did not reach the Gate. The run stopped before the Gate took it.",
	);
});

test("a deadline that left the Gate to an answer counts again once that answer did not reach it", async () => {
	const { h, runner, clock, stepId } = await setup({
		keep: gate({ minutes: 10, choose: "drop" }),
	});
	let looks = 0;
	const check = () => {
		if (looks++ > 0) {
			throw new RunRefusal("gate-closed", "Someone else answered it.");
		}
	};
	await runner.take(
		h.runId,
		{ kind: "answer", stepId, choice: "keep", note: "Mine." },
		{ check },
	);
	// The deadline comes while the answer waits: it leaves the Gate to it.
	clock.now = T0 + 10 * MINUTE;
	await runner.take(h.runId, { kind: "wake", early: false });
	await waitFor(async () => (await stepOf(h, "keep"))?.endedAt != null, {
		timeoutMs: 10_000,
		label: "the deadline to answer the Gate after the warning",
	});
	expect((await stepOf(h, "keep"))?.outcome).toBe("drop");
});
