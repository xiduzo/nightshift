import { describe, expect, test } from "bun:test";
import { runEvents } from "../../testing/run-events";
import { foldRun, nextState } from "./fold-run";

/**
 * Scale of folding a run's items. The batch fold reads each item a
 * constant number of times. One event at a time still copies the list it
 * publishes, so that path has its own ceiling.
 */

function itemLog(count: number) {
	const log = runEvents().runStarted().stepStarted("s1", "each");
	for (let i = 0; i < count; i++) {
		log.push(
			"ItemStarted",
			{
				item: { id: `i${i}`, title: "Item", url: null, value: i },
				index: i + 1,
				branch: null,
				baseBranch: null,
			},
			{ stepId: "s1" },
		);
	}
	return log.events;
}

/**
 * The time this thread worked so far, in ms. The time that the machine
 * gives to other work does not count, so a busy machine does not change it.
 */
function workedMs(): number {
	const { user, system } = process.threadCpuUsage();
	return (user + system) / 1_000;
}

function cost(run: () => void, times: number): number {
	const started = workedMs();
	for (let i = 0; i < times; i++) run();
	return workedMs() - started;
}

/** A measurement of `small` below this many ms is too small to mean something. */
const FLOOR_MS = 8;

/**
 * The lowest of five rounds of `calls` calls of `small` and of `large`,
 * measured in turns. A disturbance only adds to a measurement, so the
 * lowest one is the nearest to the cost.
 */
function lowest(
	small: () => void,
	large: () => void,
	calls: number,
): { smallMs: number; largeMs: number } {
	let smallMs = Number.POSITIVE_INFINITY;
	let largeMs = Number.POSITIVE_INFINITY;
	for (let round = 0; round < 5; round++) {
		smallMs = Math.min(smallMs, cost(small, calls));
		largeMs = Math.min(largeMs, cost(large, calls));
	}
	return { smallMs, largeMs };
}

/**
 * What the same number of calls of `small` and of `large` cost. It starts
 * at `times` calls and doubles them until `small` costs twice the floor. A
 * fast machine does more calls, so the measurement always means something.
 */
function costs(
	small: () => void,
	large: () => void,
	times: number,
): { smallMs: number; largeMs: number } {
	small();
	large();
	let calls = times;
	let measured = lowest(small, large, calls);
	while (measured.smallMs < FLOOR_MS * 2 && calls < 1_000_000) {
		calls *= 2;
		measured = lowest(small, large, calls);
	}
	return measured;
}

/**
 * `large` did `factor` times the work. Twice a linear step is the line.
 * A cost that reads the list once per node lands past it.
 */
function expectLinear(
	{ smallMs, largeMs }: { smallMs: number; largeMs: number },
	factor: number,
): void {
	expect(smallMs).toBeGreaterThan(FLOOR_MS);
	expect(largeMs).toBeLessThan(smallMs * factor * 1.9 + 15);
}

describe("folding a run stays linear", () => {
	test("a batch of items", () => {
		const small = itemLog(2_000);
		const large = itemLog(8_000);
		const measured = costs(
			() => foldRun(small),
			() => foldRun(large),
			24,
		);
		expectLinear(measured, 4);
		expect(foldRun(large).steps.get("s1")?.items).toHaveLength(8_000);
	}, 20_000);

	test("one event at a time matches the batch and stays under the ceiling", () => {
		const events = itemLog(1_500);
		let state = foldRun([]);
		const oneAtATime = () => {
			state = foldRun([]);
			for (const event of events) {
				const next = nextState(state, event);
				if (!next) throw new Error("The event is not the next one.");
				state = next;
			}
		};
		// The lowest of five rounds: other work on the machine does not count.
		const rounds = [0, 1, 2, 3, 4].map(() => cost(oneAtATime, 1));
		expect(Math.min(...rounds)).toBeLessThan(200);
		expect(state.steps.get("s1")?.items).toHaveLength(1_500);
		expect(state.steps.get("s1")?.items.at(-1)?.facts.id).toBe(
			foldRun(events).steps.get("s1")?.items.at(-1)?.facts.id,
		);
	}, 20_000);

	test("an event leaves the state it read", () => {
		const events = itemLog(8);
		const kept = foldRun(events.slice(0, 6));
		const before = kept.steps.get("s1")?.items.length;
		expect(
			nextState(kept, events[6] as (typeof events)[number]),
		).not.toBeNull();
		expect(kept.steps.get("s1")?.items).toHaveLength(before ?? 0);
	});
});
