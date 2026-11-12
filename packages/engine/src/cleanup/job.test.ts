import { expect, test } from "bun:test";
import { waitFor } from "../testing/test-support";
import { startCleanupJob } from "./job";

test("sweeps after the delay and then on its interval, survives a failed sweep, and stops with the signal", async () => {
	const controller = new AbortController();
	let sweeps = 0;
	let folders = 0;
	startCleanupJob({
		sweeps: {
			"run copies": async () => {
				sweeps++;
				if (sweeps === 1) throw new Error("git is gone");
			},
			"run folders": async () => {
				folders++;
			},
		},
		ready: Promise.resolve(),
		signal: controller.signal,
		delayMs: 5,
		everyMs: 10,
	});
	// The first sweep fails; the interval still brings the next two.
	await waitFor(() => sweeps >= 3, { label: "three sweeps" });
	// The run copies failed once: the run folders were swept all the same.
	expect(folders).toBeGreaterThanOrEqual(2);
	controller.abort();
	const stopped = sweeps;
	await Bun.sleep(40);
	expect(sweeps).toBe(stopped);
});

test("tells when a round ended, also after a failed sweep, and not when the signal stopped it", async () => {
	const controller = new AbortController();
	const order: string[] = [];
	const round = Promise.withResolvers<void>();
	startCleanupJob({
		sweeps: {
			"run copies": async () => {
				order.push("run copies");
				throw new Error("git is gone");
			},
			"run folders": async () => {
				order.push("run folders");
			},
		},
		ready: Promise.resolve(),
		signal: controller.signal,
		delayMs: 0,
		swept: () => {
			order.push("swept");
			round.resolve();
		},
	});
	await round.promise;
	controller.abort();
	expect(order).toEqual(["run copies", "run folders", "swept"]);

	// The engine stops between the two sweeps: the round did not end.
	const stopping = new AbortController();
	const stopped = Promise.withResolvers<void>();
	let told = false;
	let folders = false;
	startCleanupJob({
		sweeps: {
			"run copies": async () => {
				stopping.abort();
				stopped.resolve();
			},
			"run folders": async () => {
				folders = true;
			},
		},
		ready: Promise.resolve(),
		signal: stopping.signal,
		delayMs: 0,
		swept: () => {
			told = true;
		},
	});
	await stopped.promise;
	// A timer comes after every pending promise job of the round.
	await Bun.sleep(1);
	expect(folders).toBe(false);
	expect(told).toBe(false);
});

test("never sweeps twice at once, nor when the engine did not start", async () => {
	const controller = new AbortController();
	let running = 0;
	let most = 0;
	let started = 0;
	startCleanupJob({
		sweeps: {
			"run copies": async () => {
				started++;
				running++;
				most = Math.max(most, running);
				await Bun.sleep(30);
				running--;
			},
		},
		ready: Promise.resolve(),
		signal: controller.signal,
		delayMs: 0,
		everyMs: 5,
	});
	let never = 0;
	startCleanupJob({
		sweeps: {
			"run copies": async () => {
				never++;
			},
		},
		ready: Promise.reject(new Error("no database")),
		signal: controller.signal,
		delayMs: 0,
	});
	// Each sweep outlasts several intervals: the next waits for it.
	await waitFor(() => started >= 2, { label: "two sweeps" });
	controller.abort();
	expect(most).toBe(1);
	expect(never).toBe(0);
});
