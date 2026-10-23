import { expect, test } from "bun:test";
import { startCleanupJob } from "./job";
import { cleanupTime, isSafeToRemove } from "./safety";

test("sweeps after the delay and then on its interval, survives a failed sweep, and stops with the signal", async () => {
	const controller = new AbortController();
	let sweeps = 0;
	startCleanupJob({
		sweep: async () => {
			sweeps++;
			if (sweeps === 1) throw new Error("git is gone");
		},
		ready: Promise.resolve(),
		signal: controller.signal,
		delayMs: 5,
		everyMs: 10,
	});
	await Bun.sleep(60);
	expect(sweeps).toBeGreaterThanOrEqual(3);
	controller.abort();
	const stopped = sweeps;
	await Bun.sleep(40);
	expect(sweeps).toBe(stopped);
});

test("never sweeps twice at once, nor when the engine did not start", async () => {
	const controller = new AbortController();
	let running = 0;
	let most = 0;
	startCleanupJob({
		sweep: async () => {
			running++;
			most = Math.max(most, running);
			await Bun.sleep(30);
			running--;
		},
		ready: Promise.resolve(),
		signal: controller.signal,
		delayMs: 0,
		everyMs: 5,
	});
	let never = 0;
	startCleanupJob({
		sweep: async () => {
			never++;
		},
		ready: Promise.reject(new Error("no database")),
		signal: controller.signal,
		delayMs: 0,
	});
	await Bun.sleep(80);
	controller.abort();
	expect(most).toBe(1);
	expect(never).toBe(0);
});

test("safe: nothing uncommitted and no commit only here; a folder git does not know never is", () => {
	const state = {
		worktreePath: "/x",
		exists: true,
		registered: true,
		changes: 0,
		branches: [
			{
				name: "nightshift/a",
				merged: false,
				pushed: true,
				ahead: 0,
				unsaved: 0,
			},
		],
	};
	expect(isSafeToRemove(state)).toBe(true);
	expect(isSafeToRemove({ ...state, changes: 2 })).toBe(false);
	expect(isSafeToRemove({ ...state, changes: null })).toBe(false);
	expect(isSafeToRemove({ ...state, registered: false })).toBe(false);
	expect(
		isSafeToRemove({
			...state,
			branches: [
				{ name: "b", merged: false, pushed: false, ahead: null, unsaved: 1 },
			],
		}),
	).toBe(false);
	expect(cleanupTime({ createdAt: 0, endedAt: 1000 }, 14)).toBe(
		1000 + 14 * 24 * 60 * 60_000,
	);
	expect(cleanupTime({ createdAt: 5, endedAt: null }, 1)).toBe(
		5 + 24 * 60 * 60_000,
	);
});
