import { describe, expect, test } from "bun:test";
import { backoff, pause } from "./backoff";

describe("backoff", () => {
	test("doubles from the first wait up to the most, and starts again after a reset", () => {
		const waits = backoff({ firstMs: 100, maxMs: 500, random: () => 0.999 });
		expect([waits.next(), waits.next(), waits.next(), waits.next()]).toEqual([
			100, 200, 400, 500,
		]);
		waits.reset();
		expect(waits.next()).toBe(100);
	});

	test("waits between half and all of each step, at random", () => {
		const shortest = backoff({ firstMs: 100, maxMs: 500, random: () => 0 });
		expect([shortest.next(), shortest.next(), shortest.next()]).toEqual([
			50, 100, 200,
		]);
		const waits = backoff({ firstMs: 100, maxMs: 500 });
		const steps = [100, 200, 400, 500, 500, 500];
		for (const step of steps) {
			const ms = waits.next();
			expect(ms).toBeGreaterThanOrEqual(step / 2);
			expect(ms).toBeLessThanOrEqual(step);
		}
	});
});

describe("pause", () => {
	test("waits, or ends at once when the signal aborts", async () => {
		const started = Date.now();
		await pause(20);
		expect(Date.now() - started).toBeGreaterThanOrEqual(15);

		const stop = new AbortController();
		const waiting = pause(60_000, stop.signal);
		stop.abort();
		await waiting;
		await pause(60_000, stop.signal);
	});
});
