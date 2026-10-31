import { describe, expect, test } from "bun:test";

import { createTicker } from "./ticker";

/** A clock the test moves by hand, and the timers it runs. */
function fakeClock(start = 1_000_000) {
	let time = start;
	const timers = new Set<() => void>();
	return {
		clock: {
			now: () => time,
			every(run: () => void) {
				timers.add(run);
				return () => timers.delete(run);
			},
		},
		timers,
		advance(ms: number) {
			time += ms;
			for (const run of [...timers]) run();
		},
		set(ms: number) {
			time = ms;
		},
	};
}

describe("the shared ticker", () => {
	test("runs one timer for every listener, and none without them", () => {
		const fake = fakeClock();
		const ticker = createTicker(30_000, fake.clock);
		expect(fake.timers.size).toBe(0);
		const stopA = ticker.subscribe(() => {});
		const stopB = ticker.subscribe(() => {});
		expect(fake.timers.size).toBe(1);
		stopA();
		expect(fake.timers.size).toBe(1);
		stopB();
		expect(fake.timers.size).toBe(0);
	});

	test("tells every listener on a tick, with the new time", () => {
		const fake = fakeClock();
		const ticker = createTicker(30_000, fake.clock);
		const seen: number[] = [];
		ticker.subscribe(() => seen.push(ticker.now()));
		ticker.subscribe(() => seen.push(ticker.now()));
		fake.advance(30_000);
		expect(seen).toEqual([1_030_000, 1_030_000]);
	});

	test("keeps the same time between ticks", () => {
		const fake = fakeClock();
		const ticker = createTicker(30_000, fake.clock);
		ticker.subscribe(() => {});
		fake.set(1_020_000);
		expect(ticker.now()).toBe(1_000_000);
		expect(ticker.now()).toBe(1_000_000);
	});

	test("reads the clock again after nobody listened for a period", () => {
		const fake = fakeClock();
		const ticker = createTicker(30_000, fake.clock);
		fake.set(1_090_000);
		expect(ticker.now()).toBe(1_090_000);
		const seen: number[] = [];
		fake.set(1_200_000);
		ticker.subscribe(() => seen.push(ticker.now()));
		expect(seen).toEqual([1_200_000]);
	});

	test("ticks at once when the app comes back, only while someone listens", () => {
		const fake = fakeClock();
		const ticker = createTicker(30_000, fake.clock);
		const seen: number[] = [];
		const stop = ticker.subscribe(() => seen.push(ticker.now()));
		fake.set(1_005_000);
		ticker.tick();
		expect(seen).toEqual([1_005_000]);
		stop();
		ticker.tick();
		expect(seen).toEqual([1_005_000]);
	});
});
