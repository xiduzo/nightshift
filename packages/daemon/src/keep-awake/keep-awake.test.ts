import { describe, expect, test } from "bun:test";

import { createKeepAwake, type RunFacts, type RunSource } from "./keep-awake";
import { type LockPrograms, systemSleepLock } from "./sleep-lock";

/** Run facts that a test sets, and run events it lands. */
function fakeRuns(open: RunFacts[] = []) {
	const runs = new Map(open.map((run) => [run.id, run]));
	const listeners = new Set<(runIds: readonly string[]) => void>();
	let reads = 0;
	const source: RunSource = {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		run: async (runId) => {
			reads++;
			return runs.get(runId) ?? null;
		},
		openRuns: async () => {
			reads++;
			return [...runs.values()];
		},
	};
	return {
		source,
		set(run: RunFacts) {
			runs.set(run.id, run);
			for (const listener of listeners) listener([run.id]);
		},
		/** Whether the keep-awake follows the runs now. */
		followed: () => listeners.size > 0,
		/** How many times the runs were read. */
		reads: () => reads,
	};
}

const run = (
	id: string,
	status: RunFacts["status"],
	where: {
		walker?: boolean;
		device?: boolean;
		wakeAt?: number | null;
		waitReason?: RunFacts["waitReason"];
	} = {},
): RunFacts => ({
	id,
	status,
	wakeAt: where.wakeAt ?? null,
	waitReason: where.waitReason ?? (where.wakeAt ? "duration" : null),
	walker: { thisDevice: where.walker ?? true },
	device: { thisDevice: where.device ?? where.walker ?? true },
});

/** A sleep lock that counts its holds. */
function fakeLock() {
	const holds: { released: boolean; end(): void }[] = [];
	return {
		holds,
		live: () => holds.filter((h) => !h.released).length,
		lock: {
			acquire() {
				let end: () => void = () => {};
				const ended = new Promise<void>((resolve) => {
					end = resolve;
				});
				const hold = {
					released: false,
					end,
				};
				holds.push(hold);
				return {
					ended,
					release() {
						hold.released = true;
						end();
					},
				};
			},
		},
	};
}

describe("keep this computer awake", () => {
	test("holds the lock while a run here runs, and lets go when the last one ends", async () => {
		const runs = fakeRuns();
		const lock = fakeLock();
		const awake = createKeepAwake({
			enabled: () => true,
			runs: runs.source,
			lock: lock.lock,
			checkMs: 1_000_000,
		});
		await awake.start();
		expect(awake.holding()).toBe(false);

		runs.set(run("run-1", "running"));
		runs.set(run("run-2", "running"));
		await awake.idle();
		expect(lock.holds).toHaveLength(1);

		runs.set(run("run-1", "finished"));
		await awake.idle();
		expect(lock.live()).toBe(1);

		runs.set(run("run-2", "failed"));
		await awake.idle();
		expect(lock.live()).toBe(0);
		awake.stop();
	});

	test("is off by default: the setting turns it on and off", async () => {
		let enabled = false;
		const runs = fakeRuns([run("run-1", "running")]);
		const lock = fakeLock();
		const awake = createKeepAwake({
			enabled: () => enabled,
			runs: runs.source,
			lock: lock.lock,
			checkMs: 1_000_000,
		});
		await awake.start();
		expect(awake.holding()).toBe(false);
		// Off: it does not follow the runs, nor read them.
		expect(runs.followed()).toBe(false);
		runs.set(run("run-2", "running"));
		await awake.idle();
		expect(runs.reads()).toBe(0);

		enabled = true;
		awake.check();
		await awake.idle();
		expect(runs.followed()).toBe(true);
		expect(awake.holding()).toBe(true);

		enabled = false;
		awake.check();
		expect(lock.live()).toBe(0);
		expect(runs.followed()).toBe(false);

		// On again: it reads the runs again and follows them.
		enabled = true;
		awake.check();
		await awake.idle();
		expect(lock.live()).toBe(1);
		runs.set(run("run-1", "finished"));
		runs.set(run("run-2", "finished"));
		await awake.idle();
		expect(lock.live()).toBe(0);
		awake.stop();
	});

	test("only runs that need this computer count", async () => {
		const runs = fakeRuns([
			run("gate", "waiting"),
			run("signal", "sleeping"),
			run("elsewhere", "running", { walker: false, device: false }),
		]);
		const lock = fakeLock();
		const awake = createKeepAwake({
			enabled: () => true,
			runs: runs.source,
			lock: lock.lock,
			checkMs: 1_000_000,
		});
		await awake.start();
		expect(awake.holding()).toBe(false);

		// A step of a run walked elsewhere runs here.
		runs.set(run("placed", "running", { walker: false, device: true }));
		await awake.idle();
		expect(awake.holding()).toBe(true);
		runs.set(
			run("placed", "sleeping", { walker: false, device: true, wakeAt: 5 }),
		);
		await awake.idle();
		expect(lock.live()).toBe(1);
		awake.stop();
		expect(lock.live()).toBe(0);
	});

	test("a step that waits for another Device that is offline does not keep this computer awake", async () => {
		const runs = fakeRuns([
			run("waits", "sleeping", {
				wakeAt: 60_000,
				waitReason: "device-offline",
			}),
		]);
		const lock = fakeLock();
		const awake = createKeepAwake({
			enabled: () => true,
			runs: runs.source,
			lock: lock.lock,
			checkMs: 1_000_000,
		});
		await awake.start();
		expect(awake.holding()).toBe(false);

		// The Device is back: the step runs here.
		runs.set(run("waits", "running"));
		await awake.idle();
		expect(awake.holding()).toBe(true);

		// It went away again.
		runs.set(
			run("waits", "sleeping", {
				wakeAt: 60_000,
				waitReason: "device-offline",
			}),
		);
		await awake.idle();
		expect(lock.live()).toBe(0);
		awake.stop();
	});

	test("a lock that ended on its own is held again after a pause, not in a loop", async () => {
		let clock = 0;
		const runs = fakeRuns([run("run-1", "running")]);
		const lock = fakeLock();
		const awake = createKeepAwake({
			enabled: () => true,
			runs: runs.source,
			lock: lock.lock,
			checkMs: 1_000_000,
			retryMs: 60_000,
			now: () => clock,
			onError: () => {},
		});
		await awake.start();
		lock.holds[0]?.end();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(awake.holding()).toBe(false);

		awake.check();
		expect(lock.holds).toHaveLength(1);
		clock = 60_000;
		awake.check();
		expect(lock.holds).toHaveLength(2);
		awake.stop();
	});

	test("without a lock on this OS, the setting does nothing", async () => {
		const awake = createKeepAwake({
			enabled: () => true,
			runs: fakeRuns([run("run-1", "running")]).source,
			lock: null,
			checkMs: 1_000_000,
		});
		await awake.start();
		expect(awake.holding()).toBe(false);
		awake.stop();
	});
});

describe("the sleep lock of each OS", () => {
	function programs(installed: string[]) {
		const started: { command: readonly string[]; killed: boolean }[] = [];
		const fake: LockPrograms = {
			which: (name) => (installed.includes(name) ? `/usr/bin/${name}` : null),
			spawn(command) {
				const entry = { command, killed: false };
				started.push(entry);
				return {
					exited: new Promise(() => {}),
					kill: () => {
						entry.killed = true;
					},
				};
			},
		};
		return { fake, started };
	}

	test("macOS: caffeinate, until the daemon's process ends", () => {
		const { fake, started } = programs(["caffeinate"]);
		const hold = systemSleepLock({
			platform: "darwin",
			pid: 4242,
			programs: fake,
		})?.acquire();
		expect(started[0]?.command).toEqual([
			"/usr/bin/caffeinate",
			"-i",
			"-w",
			"4242",
		]);
		hold?.release();
		expect(started[0]?.killed).toBe(true);
	});

	test("Linux: systemd-inhibit around a wait for the daemon's process", () => {
		const { fake, started } = programs(["systemd-inhibit", "tail"]);
		systemSleepLock({
			platform: "linux",
			pid: 4242,
			programs: fake,
		})?.acquire();
		expect(started[0]?.command).toEqual([
			"/usr/bin/systemd-inhibit",
			"--what=idle:sleep",
			"--who=Night Shift",
			"--why=A run is running",
			"--mode=block",
			"/usr/bin/tail",
			"--pid=4242",
			"-f",
			"/dev/null",
		]);
	});

	test("Windows, or a missing program: no lock", () => {
		expect(
			systemSleepLock({ platform: "win32", programs: programs([]).fake }),
		).toBeNull();
		expect(
			systemSleepLock({ platform: "linux", programs: programs(["tail"]).fake }),
		).toBeNull();
	});
});
