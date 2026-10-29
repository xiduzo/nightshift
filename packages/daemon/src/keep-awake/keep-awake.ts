import type { Engine, RunHere } from "@nightshift/engine";

import type { SleepHold, SleepLock } from "./sleep-lock";

/**
 * "Keep this computer awake": while the setting is
 * on and a run needs this computer, the daemon holds the OS's sleep lock.
 * It lets go when the last such run ends, or when the setting goes off.
 *
 * A run needs this computer while it runs, or sleeps until a timer (a
 * usage limit, a network failure, a Wait with a timeout), and this
 * computer walks it or runs its steps. A run that waits for a person at a
 * Gate, for a signal with no timeout, or for another Device that is
 * offline, does not keep it awake: the Device that comes back wakes the
 * step, and a computer that sleeps meanwhile wakes for nothing.
 *
 * It follows the runs only while the setting is on (and the OS has a
 * sleep lock): with it off, a landed event costs nothing here.
 */

/** What decides whether a run needs this computer. */
export type RunFacts = Pick<
	RunHere,
	"id" | "status" | "wakeAt" | "waitReason"
> & {
	walker: { thisDevice: boolean };
	device: { thisDevice: boolean };
};

/** The runs of this Replica, as the keep-awake reads them. */
export type RunSource = {
	/** Calls `listener` with the ids of the runs whose events landed. Returns the unsubscribe. */
	subscribe(listener: (runIds: readonly string[]) => void): () => void;
	/** The run now. Null when this Replica has no such run. */
	run(runId: string): Promise<RunFacts | null>;
	/** The runs that have not ended, at the start. */
	openRuns(): Promise<RunFacts[]>;
};

export function needsThisComputer(run: RunFacts): boolean {
	const here = run.walker.thisDevice || run.device.thisDevice;
	if (!here) return false;
	if (run.status === "running") return true;
	return (
		run.status === "sleeping" &&
		run.wakeAt !== null &&
		run.waitReason !== "device-offline"
	);
}

/** One run, from one row and the facts the run log keeps, not the run page. */
async function runFactsOf(
	engine: Pick<Engine, "runHere">,
	runId: string,
): Promise<RunFacts | null> {
	const here = await engine.runHere(runId).catch(() => null);
	if (!here) return null;
	return {
		id: here.id,
		status: here.status,
		wakeAt: here.wakeAt,
		waitReason: here.waitReason,
		walker: { thisDevice: here.walkedHere },
		device: { thisDevice: here.stepsHere },
	};
}

/** The engine's runs, in every Space of this Replica. */
export function engineRunSource(
	engine: Pick<Engine, "onLandedFacts" | "runHere" | "space">,
	spaces: () => Promise<string[]>,
): RunSource {
	return {
		subscribe: (listener) =>
			engine.onLandedFacts((facts) => {
				// A spend so far changes no run's status.
				const runIds = new Set(
					facts.filter((f) => f.changes !== "spend").map((f) => f.runId),
				);
				if (runIds.size > 0) listener([...runIds]);
			}),
		run: (runId) => runFactsOf(engine, runId),
		async openRuns() {
			const out: RunFacts[] = [];
			for (const spaceId of await spaces()) {
				const runs = await engine.space(spaceId).listRuns();
				for (const run of runs) {
					if (run.endedAt !== null) continue;
					// The summary does not say what a sleeping run waits for.
					const facts = await runFactsOf(engine, run.id);
					if (facts) out.push(facts);
				}
			}
			return out;
		},
	};
}

export type KeepAwakeOptions = {
	/** The setting, read on each check: a change applies within `checkMs`. */
	enabled(): boolean;
	runs: RunSource;
	/** Null: this OS has no sleep lock. The setting then does nothing. */
	lock: SleepLock | null;
	/** How often the setting is read again. Default 5 s. */
	checkMs?: number;
	/** How long to wait before a new hold after one ended on its own. Default 60 s. */
	retryMs?: number;
	now?: () => number;
	onError?: (message: string, error: unknown) => void;
};

export type KeepAwake = {
	/** While the setting is on: reads the runs that need this computer, then follows their events. */
	start(): Promise<void>;
	/** Lets go of the lock and stops following. */
	stop(): void;
	/** Whether the lock is held now. */
	holding(): boolean;
	/** Applies the setting and the runs now: follows the runs or stops. For tests. */
	check(): void;
	/** Resolves once every run read so far is done. For tests. */
	idle(): Promise<void>;
};

export function createKeepAwake(options: KeepAwakeOptions): KeepAwake {
	const now = options.now ?? Date.now;
	const retryMs = options.retryMs ?? 60_000;
	const onError =
		options.onError ??
		((message: string, error: unknown) =>
			console.error(`[keep-awake] ${message}`, error));
	/** The runs that need this computer now. */
	const active = new Set<string>();
	let hold: SleepHold | null = null;
	/** When a hold last ended on its own. */
	let brokeAt: number | null = null;
	let queue: Promise<void> = Promise.resolve();
	/** Set while the runs are followed. */
	let unsubscribe: (() => void) | null = null;
	/** Counts the follows, so a read of an earlier one changes nothing. */
	let follows = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let stopped = false;

	function enqueue(job: () => Promise<void>): void {
		queue = queue
			.then(job)
			.catch((error) => onError("The runs were not read.", error));
	}

	function release(): void {
		const current = hold;
		hold = null;
		current?.release();
	}

	/** Reads the runs that need this computer, then follows their events. */
	function follow(): void {
		const current = ++follows;
		const read = async (runIds: readonly string[]) => {
			for (const runId of runIds) {
				const run = await options.runs.run(runId);
				if (current !== follows) return;
				if (run && needsThisComputer(run)) active.add(runId);
				else active.delete(runId);
			}
			check();
		};
		unsubscribe = options.runs.subscribe((runIds) => {
			enqueue(() => read(runIds));
		});
		enqueue(async () => {
			const open = await options.runs.openRuns();
			if (current !== follows) return;
			for (const run of open) {
				if (needsThisComputer(run)) active.add(run.id);
			}
			check();
		});
	}

	function unfollow(): void {
		follows++;
		unsubscribe?.();
		unsubscribe = null;
		active.clear();
	}

	function check(): void {
		const on = !stopped && options.lock !== null && options.enabled();
		if (on && !unsubscribe) follow();
		if (!on && unsubscribe) unfollow();
		const wanted = on && active.size > 0;
		if (!wanted) {
			release();
			return;
		}
		if (hold || !options.lock) return;
		if (brokeAt !== null && now() - brokeAt < retryMs) return;
		const current = options.lock.acquire();
		hold = current;
		void current.ended.then(() => {
			if (hold !== current) return;
			// The program ended on its own: try again later, not in a loop.
			hold = null;
			brokeAt = now();
			onError(
				"This computer could not be kept awake.",
				new Error("The sleep lock ended on its own."),
			);
		});
	}

	return {
		async start() {
			stopped = false;
			timer = setInterval(check, options.checkMs ?? 5_000);
			check();
			await queue;
		},
		stop() {
			stopped = true;
			unfollow();
			if (timer) clearInterval(timer);
			timer = null;
			release();
		},
		holding: () => hold !== null,
		check,
		idle: () => queue,
	};
}
