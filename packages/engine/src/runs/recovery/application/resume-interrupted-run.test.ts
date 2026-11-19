import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { TakeOptions } from "../../../graph";
import type { EnginePayloads } from "../../../log";
import { runRecord } from "../../access/adapters/out/in-memory-run-records";
import {
	eventsOf,
	inMemoryRecoveryPorts,
} from "../adapters/out/in-memory-neighbours";
import {
	type ResumeInterruptedRunPorts,
	resumeInterruptedRun,
} from "./resume-interrupted-run";

/**
 * The daemon's own resume of a run that startup recovery interrupted, on
 * in-memory adapters. The resume itself (the re-entry, `RunResumed`, the
 * drive) is the runner's: the whole engine's tests prove it.
 */

const RUN_ID = "run-1";
const started = {
	projectId: "project-1",
	flowName: "f",
	title: "f",
	start: "a",
} as EnginePayloads["RunStarted"];

/** A run that recovery ended interrupted. */
const interrupted = () =>
	eventsOf(RUN_ID)
		.push("RunStarted", started)
		.push("RunEnded", { status: "interrupted", reason: "Night Shift stopped." })
		.events;

let warned: unknown[][] = [];
let failed: unknown[][] = [];
let spies: ReturnType<typeof spyOn>[] = [];
beforeEach(() => {
	warned = [];
	failed = [];
	spies = [
		spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
			warned.push(args);
		}),
		spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			failed.push(args);
		}),
	];
});
afterEach(() => {
	for (const spy of spies) spy.mockRestore();
});

/** Ports with the interrupted run in `space-1`, and what each part saw. */
function setup(
	overrides: Partial<ResumeInterruptedRunPorts> = {},
	log = interrupted(),
) {
	const ports = inMemoryRecoveryPorts();
	ports.runs.add(runRecord({ id: RUN_ID, spaceId: "space-1" }));
	ports.facts.seed(RUN_ID, log);
	const options: (TakeOptions | undefined)[] = [];
	let why: string | null = null;
	const resume = resumeInterruptedRun({
		stopped: () => false,
		recovered: async () => {},
		openRun: ports.openRun,
		holds: ports.holds,
		facts: ports.facts,
		turns: {
			isActive: (runId) => ports.turns.isActive(runId),
			take: (runId, intent, given) => {
				options.push(given);
				return ports.turns.take(runId, intent, given);
			},
		},
		checkResume: async () => why,
		openWork: ports.openWork,
		...overrides,
	});
	return {
		ports,
		resume,
		options,
		because(reason: string) {
			why = reason;
		},
	};
}

describe("resumeInterruptedRun", () => {
	test("an interrupted run continues in a Turn of the daemon, inside the start hold of its Space", async () => {
		const { ports, resume, options } = setup();
		await resume(RUN_ID);
		expect(ports.holds.started).toEqual([{ spaceId: "space-1", when: "wait" }]);
		expect(ports.turns.taken).toEqual([
			{ runId: RUN_ID, intent: { kind: "resume", by: "daemon" } },
		]);
		expect(options[0]?.whenFull).toBe("queue");
	});

	test("a full run cap queues it, and a freed slot asks again from the top", async () => {
		const { ports, resume, options } = setup();
		await resume(RUN_ID);
		options[0]?.retry?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ports.holds.started).toHaveLength(2);
		expect(ports.turns.taken).toHaveLength(2);
	});

	test("a run a person resumed meanwhile is left alone", async () => {
		const resumed = eventsOf(RUN_ID)
			.push("RunStarted", started)
			.push("RunEnded", {
				status: "interrupted",
				reason: "Night Shift stopped.",
			})
			.push("RunResumed", {
				nodeId: "a",
				stepId: null,
				prompt: null,
				by: "person",
			});
		const { ports, resume } = setup({}, resumed.events);
		await resume(RUN_ID);
		expect(ports.turns.taken).toEqual([]);
	});

	test("a run a drive holds is left alone", async () => {
		const { ports, resume } = setup();
		ports.turns.set(RUN_ID, {
			row: runRecord({ id: RUN_ID, spaceId: "space-1" }),
			runState: eventsOf(RUN_ID).push("RunStarted", started).state(),
			active: true,
		});
		await resume(RUN_ID);
		expect(ports.turns.taken).toEqual([]);
	});

	test("a run that may not continue now says why and lets go of what it holds", async () => {
		const { ports, resume, because } = setup();
		because("its stop time has passed.");
		await resume(RUN_ID);
		expect(ports.turns.taken).toEqual([]);
		expect(ports.openWork.letGone).toEqual([RUN_ID]);
		expect(warned[0]?.[0]).toBe(
			"[engine] run run-1 did not continue on its own: its stop time has passed.",
		);
	});

	test("a stopped engine resumes nothing", async () => {
		const { ports, resume } = setup({ stopped: () => true });
		await resume(RUN_ID);
		expect(ports.holds.started).toEqual([]);
		expect(ports.turns.taken).toEqual([]);
	});

	test("an engine that stops while the start hold waits resumes nothing", async () => {
		let stopped = false;
		const { ports, resume } = setup({
			stopped: () => stopped,
			holds: {
				start<T>(_spaceId: string, work: () => Promise<T>) {
					stopped = true;
					return work();
				},
			},
		});
		await resume(RUN_ID);
		expect(ports.turns.taken).toEqual([]);
	});

	test("it waits for startup recovery first", async () => {
		let done = () => {};
		const recovering = new Promise<void>((resolve) => {
			done = resolve;
		});
		const { ports, resume } = setup({ recovered: () => recovering });
		const resumed = resume(RUN_ID);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(ports.holds.started).toEqual([]);
		done();
		await resumed;
		expect(ports.turns.taken).toHaveLength(1);
	});

	test("a run this Replica does not have is skipped, with no error", async () => {
		const { ports, resume } = setup();
		await resume("run-gone");
		expect(ports.holds.started).toEqual([]);
		expect(failed).toEqual([]);
	});

	test("a failure is logged, never thrown", async () => {
		const { resume } = setup({
			openRun: async () => {
				throw new Error("the database is locked");
			},
		});
		await resume(RUN_ID);
		expect(failed[0]?.[0]).toBe("[engine] could not resume run run-1");
	});
});
