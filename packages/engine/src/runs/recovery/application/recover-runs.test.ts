import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { EnginePayloads } from "../../../log";
import {
	eventsOf,
	inMemoryRecoveryPorts,
} from "../adapters/out/in-memory-neighbours";
import { recoverRuns } from "./recover-runs";

/**
 * Startup recovery on in-memory adapters: what a new daemon does with
 * each run the last one left open. What a cut writes in the log is the
 * contract of `OpenWork`, and the whole engine's `recovery.test.ts`.
 */

const started = {
	projectId: "project-1",
	flowName: "f",
	title: "f",
	start: "a",
} as EnginePayloads["RunStarted"];
const stepStarted = {
	nodeId: "a",
	nodeType: "agent",
	visit: 1,
	transcriptPath: "/t/s1",
	logPath: null,
	scope: null,
} as EnginePayloads["StepStarted"];

/** A run whose agent step `s1` ran when the daemon died. */
const ran = (runId: string) =>
	eventsOf(runId).push("RunStarted", started).push("StepStarted", stepStarted, {
		stepId: "s1",
	}).events;

/** A run whose step `s1` sleeps in a Wait. */
const slept = (runId: string) =>
	eventsOf(runId)
		.push("RunStarted", started)
		.push("StepStarted", stepStarted, { stepId: "s1" })
		.push(
			"WaitStarted",
			{ reason: "duration", until: 5_000, message: "It waits.", since: 1 },
			{ stepId: "s1" },
		).events;

let warned: unknown[][] = [];
let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	warned = [];
	warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
		warned.push(args);
	});
});
afterEach(() => {
	warn.mockRestore();
});

/** Ports, and the reasons `checkResume` gives by run (none: the run continues). */
function setup(
	why: Record<string, string> = {},
	older: Record<string, string> = {},
) {
	const ports = inMemoryRecoveryPorts();
	const asked: string[] = [];
	const recover = recoverRuns({
		openWork: ports.openWork,
		turns: ports.turns,
		olderRun: async (runId) => older[runId] ?? null,
		checkResume: async (runId) => {
			asked.push(runId);
			return why[runId] ?? null;
		},
		fold: ports.fold,
		whatIsOpen: ports.whatIsOpen,
	});
	return { ports, recover, asked };
}

describe("recoverRuns", () => {
	test("a run that ran ends interrupted, keeps only what a resume reads, and continues", async () => {
		const { ports, recover } = setup();
		ports.openWork.add("run-1", ran("run-1"));
		expect(await recover()).toEqual(["run-1"]);
		expect(ports.openWork.pruned).toBe(1);
		expect(ports.turns.taken).toEqual([
			{ runId: "run-1", intent: { kind: "overdue", graceMs: 0 } },
			{ runId: "run-1", intent: { kind: "prune" } },
		]);
		expect(ports.openWork.closed).toEqual([
			{ runId: "run-1", reason: "Night Shift stopped while this run ran." },
		]);
		expect(ports.openWork.letGone).toEqual([]);
		expect(ports.turns.restored).toEqual([]);
	});

	test("a run that does not continue says why in its end, and lets go of what it holds", async () => {
		const { ports, recover } = setup({ "run-1": "schedules are paused." });
		ports.openWork.add("run-1", ran("run-1"));
		expect(await recover()).toEqual([]);
		expect(ports.openWork.closed).toEqual([
			{
				runId: "run-1",
				reason:
					"Night Shift stopped while this run ran. It did not continue on its own: schedules are paused.",
			},
		]);
		expect(ports.openWork.letGone).toEqual(["run-1"]);
	});

	test("a step past its limits ends as its timer would: the run fails and recovery leaves it", async () => {
		const { ports, recover, asked } = setup();
		ports.openWork.add("run-1", ran("run-1"));
		ports.turns.answer({ kind: "halted" });
		expect(await recover()).toEqual([]);
		expect(ports.turns.taken.map((t) => t.intent.kind)).toEqual(["overdue"]);
		expect(ports.openWork.closed).toEqual([]);
		expect(asked).toEqual([]);
	});

	test("a sleeping run gets its timer back, and nothing of it ends", async () => {
		const { ports, recover, asked } = setup();
		const events = slept("run-1");
		ports.openWork.add("run-1", events);
		expect(await recover()).toEqual([]);
		expect(ports.turns.restored.map((r) => r.runId)).toEqual(["run-1"]);
		expect(ports.turns.restored[0]?.state.sleep).toMatchObject({
			stepId: "s1",
			until: 5_000,
		});
		expect(ports.openWork.closed).toEqual([]);
		expect(ports.turns.taken).toEqual([]);
		expect(asked).toEqual([]);
	});

	test("a run of an older flow ends with its waits, and the next run goes on", async () => {
		const reason = "This run is from an older version of Night Shift.";
		const { ports, recover, asked } = setup(
			{},
			{ ran: reason, slept: reason, ended: reason },
		);
		ports.openWork.add("ran", ran("ran"));
		ports.openWork.add("slept", slept("slept"));
		ports.openWork.add(
			"ended",
			eventsOf("ended")
				.push("RunStarted", started)
				.push("RunEnded", { status: "finished", reason: null }).events,
		);
		ports.openWork.add("new", ran("new"));
		expect(await recover()).toEqual(["new"]);
		expect(ports.openWork.closed).toEqual([
			{ runId: "ran", reason },
			{ runId: "slept", reason },
			{ runId: "new", reason: "Night Shift stopped while this run ran." },
		]);
		expect(ports.openWork.letGone).toEqual(["ran", "slept"]);
		// Nothing wakes or prunes a run that nothing can continue.
		expect(ports.turns.restored.map(({ runId }) => runId)).toEqual(["ended"]);
		expect(ports.turns.taken.map(({ runId }) => runId)).toEqual(["new", "new"]);
		expect(asked).toEqual(["new"]);
	});

	test("a run that ended has nothing open: recovery only restores it", async () => {
		const { ports, recover } = setup();
		ports.openWork.add(
			"run-1",
			eventsOf("run-1")
				.push("RunStarted", started)
				.push("RunEnded", { status: "finished", reason: null }).events,
		);
		expect(await recover()).toEqual([]);
		expect(ports.openWork.closed).toEqual([]);
		expect(ports.turns.restored.map((r) => r.runId)).toEqual(["run-1"]);
	});

	test("each run of this computer, in the order of the log", async () => {
		const { ports, recover } = setup({ "run-2": "its stop time has passed." });
		ports.openWork.add("run-1", ran("run-1"));
		ports.openWork.add("run-2", ran("run-2"));
		ports.openWork.add("run-3", slept("run-3"));
		ports.openWork.add("run-far", ran("run-far"), { walkerId: "device-far" });
		expect(await recover()).toEqual(["run-1"]);
		expect(ports.openWork.closed.map((c) => c.runId)).toEqual([
			"run-1",
			"run-2",
		]);
		expect(ports.openWork.letGone).toEqual(["run-2"]);
		expect(ports.turns.restored.map((r) => r.runId)).toEqual(["run-3"]);
	});

	test("checkpoints that cannot be pruned do not stop recovery", async () => {
		const { ports, recover } = setup();
		ports.openWork.add("run-1", ran("run-1"));
		ports.openWork.failNextPrune();
		expect(await recover()).toEqual(["run-1"]);
		expect(warned[0]?.[0]).toBe("[engine] could not prune the checkpoints");
	});

	test("a run that cannot let go is logged, and recovery goes on", async () => {
		const { ports, recover } = setup({
			"run-1": "schedules are paused.",
			"run-2": "schedules are paused.",
		});
		ports.openWork.add("run-1", ran("run-1"));
		ports.openWork.add("run-2", ran("run-2"));
		ports.openWork.failNextLetGo();
		expect(await recover()).toEqual([]);
		expect(ports.openWork.letGone).toEqual(["run-2"]);
		expect(warned[0]?.[0]).toBe(
			"[engine] could not let go of what run run-1 holds",
		);
	});
});
