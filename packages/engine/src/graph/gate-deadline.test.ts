import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DecisionNode, Flow } from "@nightshift/flows";
import { foldRun } from "../log";

import { getRunRow } from "../log/run-row";
import { readTranscriptFile } from "../log/transcripts";
import { deriveOpenGate, deriveRunState, deriveSteps } from "../read/run-views";
import {
	command,
	drive,
	edge,
	flowOf,
	type Harness,
	MINUTE,
	payloads,
	startRun,
	testRunner,
} from "../testing/graph";
import { createSandbox, type Sandbox, waitFor } from "../testing/test-support";
import type { Runner } from "./runner";

/**
 * A Gate's deadline. The Gate works out when it is due as it opens and
 * logs it with `GateOpened`; the runner sets a timer from the interrupt,
 * and from the log after a restart (`restore`). When the timer fires past
 * the deadline, the Gate takes the deadline's option with a note that
 * says the deadline chose it. The clock is the test's, so a test fires the
 * timer by hand (`take` with a wake) or lets `restore` fire it at once.
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

const T0 = Date.parse("2026-10-26T22:00:00");

const gate = (deadline: DecisionNode["deadline"]): DecisionNode => ({
	id: "keep",
	type: "decision",
	position: { x: 0, y: 0 },
	prompt: "Keep the branch?",
	options: [{ name: "keep" }, { name: "drop" }],
	by: "person",
	decider: "typesafe",
	deadline,
});

/** keep (keep → kept; drop → dropped). */
const keepFlow = (deadline: DecisionNode["deadline"]): Flow =>
	flowOf(
		[
			gate(deadline),
			command("kept", 'echo "{{keep.note}}"'),
			command("dropped", "true"),
		],
		[edge("e1", "keep", "keep", "kept"), edge("e2", "keep", "drop", "dropped")],
	);

/** A run of `flow` on a clock the test moves, and a runner over it. */
async function setup(flow: Flow) {
	const clock = { now: T0 };
	const now = () => clock.now;
	const h = await startRun(sandbox, flow, { now });
	const runner = testRunner(h, { now });
	runners.push(runner);
	await runner.take(h.runId, {
		kind: "start",
		prepare: async () => ({
			row: await getRunRow(sandbox.db, h.runId),
			inputs: {},
			stopAt: null,
		}),
	});
	await waitFor(async () => deriveOpenGate(foldRun(await h.events())));
	return { h, runner, clock };
}

const statusOf = async (h: Harness) =>
	deriveRunState(foldRun(await h.events())).status;

describe("a Gate with a deadline", () => {
	test("logs when it is due and what it chooses, from minutes after it opens", async () => {
		const { h } = await setup(keepFlow({ minutes: 90, choose: "keep" }));
		const events = await h.events();
		expect(payloads(events, "GateOpened")).toEqual([
			{
				question: "Keep the branch?",
				choices: [{ name: "keep" }, { name: "drop" }],
				deadline: { at: T0 + 90 * MINUTE, choose: "keep" },
			},
		]);
		expect(deriveOpenGate(foldRun(events))?.deadline).toEqual({
			at: T0 + 90 * MINUTE,
			choose: "keep",
		});
	});

	test("a time of day is the next one after the Gate opens", async () => {
		const { h } = await setup(keepFlow({ at: "07:00", choose: "keep" }));
		const due = deriveOpenGate(foldRun(await h.events()))?.deadline
			?.at as number;
		expect(new Date(due).getHours()).toBe(7);
		expect(due).toBeGreaterThan(T0);
		expect(due - T0).toBeLessThan(24 * 60 * 60 * 1000);
	});

	test("at the deadline the Gate takes its option, and the note says the deadline chose it", async () => {
		const { h, runner, clock } = await setup(
			keepFlow({ minutes: 30, choose: "keep" }),
		);
		const stepId = deriveOpenGate(foldRun(await h.events()))?.stepId as string;

		// A timer before the deadline changes nothing.
		clock.now = T0 + 29 * MINUTE;
		expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
			kind: "unchanged",
		});
		expect(await statusOf(h)).toBe("waiting");

		clock.now = T0 + 30 * MINUTE;
		expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
			kind: "driving",
		});
		await waitFor(async () => (await statusOf(h)) === "finished");

		const events = await h.events();
		const note =
			'Nobody answered by the deadline, so Night Shift chose "keep".';
		const gateStep = deriveSteps(foldRun(events)).find((s) => s.id === stepId);
		expect(gateStep?.outcome).toBe("keep");
		expect(gateStep?.outputs).toEqual({ outcome: "keep", note, visit: 1 });
		expect(
			deriveSteps(foldRun(events)).find((s) => s.nodeId === "kept")?.outputs
				.log_tail,
		).toBe(note);
		expect(
			(await readTranscriptFile(gateStep?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{
				type: "gate-open",
				question: "Keep the branch?",
				choices: [{ name: "keep" }, { name: "drop" }],
				deadline: { at: T0 + 30 * MINUTE, choose: "keep" },
			},
			{ type: "gate-resolved", choice: "keep", note, byDeadline: true },
		]);
		// The score says the deadline chose, not a person.
		const scored = events.find((e) => e.type === "Scored");
		expect(scored?.stepId).toBe(stepId);
		expect(scored?.payload).toEqual({
			score: "gate_decision",
			value: 1,
			label: "keep",
			by: "deadline",
		});
	});

	test("a person who answers first wins: the timer later changes nothing", async () => {
		const { h, runner, clock } = await setup(
			keepFlow({ minutes: 30, choose: "keep" }),
		);
		const stepId = deriveOpenGate(foldRun(await h.events()))?.stepId as string;
		await runner.take(h.runId, {
			kind: "answer",
			stepId,
			choice: "drop",
			note: "Not needed",
		});
		await waitFor(async () => (await statusOf(h)) === "finished");
		clock.now = T0 + 31 * MINUTE;
		expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
			kind: "unchanged",
		});
		const gateStep = deriveSteps(foldRun(await h.events())).find(
			(s) => s.id === stepId,
		);
		expect(gateStep?.outputs).toEqual({
			outcome: "drop",
			note: "Not needed",
			visit: 1,
		});
	});

	test("survives a restart: a new runner sets the timer from the log, and a deadline that passed fires at once", async () => {
		const { h, runner, clock } = await setup(
			keepFlow({ minutes: 30, choose: "drop" }),
		);
		await runner.release();
		clock.now = T0 + 45 * MINUTE;
		const next = testRunner(h, { now: () => clock.now });
		runners.push(next);
		next.restore(h.runId, foldRun(await h.events()));
		await waitFor(async () => (await statusOf(h)) === "finished");
		const gateStep = deriveSteps(foldRun(await h.events())).find(
			(s) => s.nodeId === "keep",
		);
		expect(gateStep?.outcome).toBe("drop");
	});

	test("a time that is not valid fails the Gate's step before it opens", async () => {
		const h = await startRun(sandbox, keepFlow({ at: "soon", choose: "keep" }));
		const driven = await drive(h, { inputs: {} });
		expect(driven.parked).toMatchObject([{ kind: "parked", status: "failed" }]);
		const [gateStep] = deriveSteps(foldRun(await h.events()));
		expect(gateStep?.outcome).toBe("error");
		expect(gateStep?.error).toBe(
			'The Gate could not open: The deadline "soon" is not valid. Write a date and time like 2026-10-18T07:00, or a time like 07:00.',
		);
		expect(payloads(await h.events(), "GateOpened")).toEqual([]);
	});
});

describe("Gates with deadlines on parallel branches", () => {
	test("the timer holds the first deadline; each Gate takes its option at its own, then the Join goes on", async () => {
		const branchGate = (id: string, minutes: number): DecisionNode => ({
			...gate({ minutes, choose: "keep" }),
			id,
		});
		const flow = flowOf(
			[
				command("start", "true"),
				branchGate("soon", 30),
				branchGate("late", 60),
				{ id: "joined", type: "join", position: { x: 0, y: 0 }, wait: "all" },
			],
			[
				edge("s1", "start", "pass", "soon"),
				edge("s2", "start", "pass", "late"),
				edge("j1", "soon", "keep", "joined"),
				edge("j2", "late", "keep", "joined"),
			],
		);
		const { h, runner, clock } = await setup(flow);
		await waitFor(
			async () =>
				!runner.isActive(h.runId) &&
				deriveSteps(foldRun(await h.events())).filter(
					(s) => s.gate !== null && s.endedAt === null,
				).length === 2,
		);
		const outcomeOf = async (nodeId: string) =>
			deriveSteps(foldRun(await h.events())).find((s) => s.nodeId === nodeId)
				?.outcome;

		// The first deadline is due: only its Gate takes its option.
		clock.now = T0 + 30 * MINUTE;
		expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
			kind: "driving",
		});
		await waitFor(
			async () =>
				!runner.isActive(h.runId) && (await outcomeOf("soon")) === "keep",
		);
		expect(await outcomeOf("late")).toBeNull();
		expect(await statusOf(h)).toBe("waiting");

		// Before the second deadline the timer changes nothing.
		clock.now = T0 + 45 * MINUTE;
		expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
			kind: "unchanged",
		});

		clock.now = T0 + 60 * MINUTE;
		expect(await runner.take(h.runId, { kind: "wake", early: false })).toEqual({
			kind: "driving",
		});
		await waitFor(async () => (await statusOf(h)) === "finished");
		expect(await outcomeOf("late")).toBe("keep");
		expect(await outcomeOf("joined")).toBe("done");
	});
});
