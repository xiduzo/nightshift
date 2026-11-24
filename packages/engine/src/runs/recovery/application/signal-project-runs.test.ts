import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runRecord } from "../../../access/adapters/out/in-memory-run-records";
import type { TakeOptions } from "../../../graph";
import type { EnginePayloads, LoggedEvent } from "../../../log";
import {
	eventsOf,
	inMemoryRecoveryPorts,
} from "../adapters/out/in-memory-neighbours";
import { signalProjectRuns } from "./signal-project-runs";

/** A webhook's signal to the runs of a project, on in-memory adapters. */

const started = {
	projectId: "project-1",
	flowName: "f",
	title: "f",
	start: "a",
} as EnginePayloads["RunStarted"];

/** A run whose Wait step `s1` waits for `signal`, with rules when given, or ended its wait when `woke`. */
function waiting(
	runId: string,
	signal: string,
	options: { rules?: { outcome: string; when: string }[]; woke?: boolean } = {},
): LoggedEvent[] {
	const log = eventsOf(runId)
		.push("RunStarted", started)
		.push(
			"StepStarted",
			{
				nodeId: "w",
				nodeType: "wait",
				visit: 1,
				transcriptPath: "/t/s1",
				logPath: null,
				scope: null,
			},
			{ stepId: "s1" },
		)
		.push(
			"WaitStarted",
			{
				reason: "signal",
				until: null,
				message: "It waits.",
				since: 1,
				signal,
				...(options.rules ? { signalRules: options.rules } : {}),
			},
			{ stepId: "s1" },
		);
	if (options.woke) log.push("WaitEnded", { early: true }, { stepId: "s1" });
	return log.events;
}

let failed: unknown[][] = [];
let spy: ReturnType<typeof spyOn>;
beforeEach(() => {
	failed = [];
	spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		failed.push(args);
	});
});
afterEach(() => {
	spy.mockRestore();
});

/** Ports with each run in the waits, the run facts and the Turns, as its log says. */
function setup(runs: Record<string, LoggedEvent[]>, failFor?: string) {
	const ports = inMemoryRecoveryPorts();
	for (const [runId, events] of Object.entries(runs)) {
		ports.waits.add(runId, { projectId: "project-1", events });
		ports.facts.seed(runId, events);
		ports.turns.set(runId, {
			row: runRecord({ id: runId, spaceId: "space-1" }),
			runState: ports.fold(events),
			active: false,
		});
	}
	const options: (TakeOptions | undefined)[] = [];
	const send = signalProjectRuns({
		waits: ports.waits,
		facts: ports.facts,
		turns: {
			take: async (runId, intent, given) => {
				options.push(given);
				if (runId === failFor) throw new Error("The disk is full.");
				return ports.turns.take(runId, intent, given);
			},
		},
	});
	return { ports, send, options };
}

const deployed = { name: "deployed", key: null, data: { env: "prod" } };

describe("signalProjectRuns", () => {
	test("wakes each run that waits for the signal with its data, queued on a full cap, and counts them", async () => {
		const { ports, send, options } = setup({
			"run-1": waiting("run-1", "deployed"),
			"run-2": waiting("run-2", "deployed"),
			"run-other": waiting("run-other", "merged"),
		});
		expect(await send("project-1", deployed)).toBe(2);
		expect(ports.turns.taken).toEqual([
			{
				runId: "run-1",
				intent: {
					kind: "wake",
					early: true,
					signal: "deployed",
					data: { env: "prod" },
				},
			},
			{
				runId: "run-2",
				intent: {
					kind: "wake",
					early: true,
					signal: "deployed",
					data: { env: "prod" },
				},
			},
		]);
		expect(options.map((o) => o?.whenFull)).toEqual(["queue", "queue"]);
	});

	test("a run that waited once and moved on is not woken", async () => {
		const { ports, send } = setup({
			"run-1": waiting("run-1", "deployed", { woke: true }),
		});
		expect(await send("project-1", deployed)).toBe(0);
		expect(ports.turns.taken).toEqual([]);
	});

	test("a run whose rules do not hold for the event is not woken", async () => {
		const { ports, send } = setup({
			"run-1": waiting("run-1", "deployed", {
				rules: [{ outcome: "test", when: 'event.env = "test"' }],
			}),
		});
		expect(await send("project-1", deployed)).toBe(0);
		expect(ports.turns.taken).toEqual([]);
	});

	test("a run that moved on before its Turn is refused quietly, and not counted", async () => {
		const { ports, send } = setup({ "run-1": waiting("run-1", "deployed") });
		// In its Turn, the run no longer waits: a person sent the signal first.
		ports.turns.set("run-1", {
			row: runRecord({ id: "run-1", spaceId: "space-1" }),
			runState: ports.fold(waiting("run-1", "deployed", { woke: true })),
			active: false,
		});
		expect(await send("project-1", deployed)).toBe(0);
		expect(ports.turns.taken).toEqual([]);
		expect(failed).toEqual([]);
	});

	test("a wake that fails for another reason is logged, and the next run still wakes", async () => {
		const { ports, send } = setup(
			{
				"run-1": waiting("run-1", "deployed"),
				"run-2": waiting("run-2", "deployed"),
			},
			"run-1",
		);
		expect(await send("project-1", deployed)).toBe(1);
		expect(ports.turns.taken.map((t) => t.runId)).toEqual(["run-2"]);
		expect(failed[0]?.[0]).toBe("[signals] could not wake run run-1");
	});
});
