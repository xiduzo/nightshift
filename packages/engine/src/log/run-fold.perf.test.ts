import { describe, expect, test } from "bun:test";
import { runEvents } from "../testing/run-events";
import { foldRun, nextState } from "./run-state";

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

function elapsed(run: () => void, times: number): number {
	run();
	const started = performance.now();
	for (let i = 0; i < times; i++) run();
	return performance.now() - started;
}

/**
 * `large` did `factor` times the work. Twice a linear step is the line.
 * A cost that reads the list once per node lands past it.
 */
function expectLinear(smallMs: number, largeMs: number, factor: number): void {
	expect(smallMs).toBeGreaterThan(8);
	expect(largeMs).toBeLessThan(smallMs * factor * 1.9 + 15);
}

describe("folding a run stays linear", () => {
	test("a batch of items", () => {
		const small = itemLog(2_000);
		const large = itemLog(8_000);
		const smallMs = elapsed(() => foldRun(small), 24);
		const largeMs = elapsed(() => foldRun(large), 24);
		expectLinear(smallMs, largeMs, 4);
		expect(foldRun(large).steps.get("s1")?.items).toHaveLength(8_000);
	}, 20_000);

	test("one event at a time matches the batch and stays under the ceiling", () => {
		const events = itemLog(1_500);
		const started = performance.now();
		let state = foldRun([]);
		for (const event of events) {
			const next = nextState(state, event);
			if (!next) throw new Error("The event is not the next one.");
			state = next;
		}
		expect(performance.now() - started).toBeLessThan(200);
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
