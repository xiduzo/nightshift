import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { EnginePayloads } from "../../../log";
import { eventsOf } from "../adapters/out/in-memory-neighbours";
import { recoveryPorts } from "../test-support";
import { recoverRuns } from "./recover-runs";

/**
 * Startup recovery over a database in memory: what a new daemon does with
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

const UNREAD = "This run cannot continue here.";

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
async function setup(
	why: Record<string, string> = {},
	unread: Record<string, "older" | "newer" | "invalid"> = {},
) {
	const ports = await recoveryPorts();
	const asked: string[] = [];
	const recover = recoverRuns({
		openWork: ports.openWork,
		turns: ports.turns,
		unread: async (runId) => {
			const unreadWhy = unread[runId];
			return unreadWhy ? { why: unreadWhy, reason: UNREAD } : null;
		},
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
		const { ports, recover } = await setup();
		await ports.addRun("run-1", ran("run-1"));
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
		const { ports, recover } = await setup({
			"run-1": "schedules are paused.",
		});
		await ports.addRun("run-1", ran("run-1"));
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
		const { ports, recover, asked } = await setup();
		await ports.addRun("run-1", ran("run-1"));
		ports.turns.answer({ kind: "halted" });
		expect(await recover()).toEqual([]);
		expect(ports.turns.taken.map((t) => t.intent.kind)).toEqual(["overdue"]);
		expect(ports.openWork.closed).toEqual([]);
		expect(asked).toEqual([]);
	});

	test("a sleeping run gets its timer back, and nothing of it ends", async () => {
		const { ports, recover, asked } = await setup();
		const events = slept("run-1");
		await ports.addRun("run-1", events);
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
		const reason = UNREAD;
		const { ports, recover, asked } = await setup(
			{},
			{ ran: "older", slept: "older", ended: "older" },
		);
		await ports.addRun("ran", ran("ran"));
		await ports.addRun("slept", slept("slept"));
		await ports.addRun(
			"ended",
			eventsOf("ended")
				.push("RunStarted", started)
				.push("RunEnded", { status: "finished", reason: null }).events,
		);
		await ports.addRun("new", ran("new"));
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

	test.each(["newer", "invalid"] as const)(
		"a run of a %s flow that ran ends interrupted, not failed by its limits, and one that sleeps stays",
		async (why) => {
			const { ports, recover } = await setup({}, { ran: why, slept: why });
			await ports.addRun("ran", ran("ran"));
			await ports.addRun("slept", slept("slept"));
			ports.turns.answer({ kind: "halted" });
			expect(await recover()).toEqual([]);
			expect(ports.openWork.closed).toEqual([{ runId: "ran", reason: UNREAD }]);
			expect(ports.openWork.letGone).toEqual(["ran"]);
			expect(ports.turns.taken).toEqual([]);
			expect(ports.turns.restored.map(({ runId }) => runId)).toEqual(["slept"]);
		},
	);

	test("a run that ended has nothing open: recovery only restores it", async () => {
		const { ports, recover } = await setup();
		await ports.addRun(
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
		const { ports, recover } = await setup({
			"run-2": "its stop time has passed.",
		});
		await ports.addRun("run-1", ran("run-1"));
		await ports.addRun("run-2", ran("run-2"));
		await ports.addRun("run-3", slept("run-3"));
		await ports.addRun("run-far", ran("run-far"), { walkerId: "device-far" });
		expect(await recover()).toEqual(["run-1"]);
		expect(ports.openWork.closed.map((c) => c.runId)).toEqual([
			"run-1",
			"run-2",
		]);
		expect(ports.openWork.letGone).toEqual(["run-2"]);
		expect(ports.turns.restored.map((r) => r.runId)).toEqual(["run-3"]);
	});

	test("checkpoints that cannot be pruned do not stop recovery", async () => {
		const { ports, recover } = await setup();
		await ports.addRun("run-1", ran("run-1"));
		ports.openWork.pruneCheckpoints = async () => {
			throw new Error("The disk is full.");
		};
		expect(await recover()).toEqual(["run-1"]);
		expect(warned[0]?.[0]).toBe("[engine] could not prune the checkpoints");
	});

	test("a run that cannot let go is logged, and recovery goes on", async () => {
		const { ports, recover } = await setup({
			"run-1": "schedules are paused.",
			"run-2": "schedules are paused.",
		});
		await ports.addRun("run-1", ran("run-1"));
		await ports.addRun("run-2", ran("run-2"));
		const { letGo } = ports.openWork;
		ports.openWork.letGo = async (runId) => {
			if (runId === "run-1") throw new Error("The Host cannot be reached.");
			return letGo(runId);
		};
		expect(await recover()).toEqual([]);
		expect(ports.openWork.letGone).toEqual(["run-2"]);
		expect(warned[0]?.[0]).toBe(
			"[engine] could not let go of what run run-1 holds",
		);
	});
});
