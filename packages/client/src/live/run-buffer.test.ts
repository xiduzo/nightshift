import { describe, expect, test } from "bun:test";

import type { RunStatus, StepSummary, TranscriptEntry } from "../runs";
import {
	createRunStreamBuffer,
	type RunStreamBatch,
	type Schedule,
} from "./run-buffer";

/** A schedule the test runs by hand: `due(ms)` runs what waits that long. */
function handSchedule() {
	const waiting: { run: () => void; ms: number }[] = [];
	const schedule: Schedule = (run, ms) => {
		const item = { run, ms };
		waiting.push(item);
		return () => {
			const at = waiting.indexOf(item);
			if (at >= 0) waiting.splice(at, 1);
		};
	};
	const due = (ms: number) => {
		for (const item of waiting.filter((one) => one.ms === ms)) {
			waiting.splice(waiting.indexOf(item), 1);
			item.run();
		}
	};
	return { schedule, due, waiting };
}

const entry = (seq: number) => ({ seq, stepId: "build" }) as TranscriptEntry;
const step = (id: string) => ({ id }) as StepSummary;

function buffer(lastSeq?: number) {
	const timers = handSchedule();
	const batches: RunStreamBatch[] = [];
	let refetches = 0;
	const it = createRunStreamBuffer({
		flushMs: 50,
		schedule: timers.schedule,
		lastSeq,
		onFlush: (batch) => batches.push(batch),
		onRunChanged: () => {
			refetches += 1;
		},
	});
	return { it, timers, batches, refetches: () => refetches };
}

describe("the buffer of a run's stream", () => {
	test("entries, steps and the status of one window make one batch", () => {
		const { it, timers, batches } = buffer();
		it.entry(entry(1));
		it.step(step("build"));
		it.entry(entry(2));
		it.status("running" as RunStatus);
		expect(batches).toEqual([]);
		timers.due(50);
		expect(batches).toEqual([
			{
				entries: [entry(1), entry(2)],
				steps: [step("build")],
				status: "running" as RunStatus,
				lastSeq: 2,
			},
		]);
	});

	test("each step and status says the run changed; entries alone do not", () => {
		const { it, timers, refetches } = buffer();
		it.entry(entry(1));
		timers.due(50);
		expect(refetches()).toBe(0);
		it.step(step("a"));
		it.status("finished" as RunStatus);
		expect(refetches()).toBe(2);
	});

	test("the last seq follows the entries, from where the follow started", () => {
		const { it, timers, batches } = buffer(7);
		it.step(step("build"));
		timers.due(50);
		it.entry(entry(8));
		timers.due(50);
		expect(batches.map((batch) => batch.lastSeq)).toEqual([7, 8]);
	});

	test("a stop with flush hands on what gathered, and nothing comes after", () => {
		const { it, timers, batches, refetches } = buffer();
		it.entry(entry(1));
		it.step(step("build"));
		it.stop({ flush: true });
		expect(batches.map((batch) => batch.entries.length)).toEqual([1]);
		it.entry(entry(2));
		it.step(step("test"));
		timers.due(50);
		expect(batches).toHaveLength(1);
		expect(refetches()).toBe(1);
		expect(timers.waiting).toEqual([]);
	});

	test("a stop without flush drops what gathered", () => {
		const { it, timers, batches } = buffer();
		it.entry(entry(1));
		it.stop();
		timers.due(50);
		expect(batches).toEqual([]);
		expect(timers.waiting).toEqual([]);
	});
});
