import type { Engine, RunSummary } from "@nightshift/engine";

import type { SleepHold, SleepLock } from "./sleep-lock";

/**
 * "Keep this computer awake": while the setting is
 * on and a run needs this computer, the daemon holds the OS's sleep lock.
 * It lets go when the last such run ends, or when the setting goes off.
 *
 * A run needs this computer while it runs, or sleeps until a timer (a
 * usage limit, a network failure, a Wait with a timeout), and this
 * computer walks it or runs its steps. A run that waits for a person at a
 * Gate, or for a signal with no timeout, does not keep it awake.
 */

/** What decides whether a run needs this computer. */
export type RunFacts = Pick<
	RunSummary,
	"id" | "status" | "wakeAt" | "walker" | "device"
>;

/** The runs of this Replica, as the keep-awake reads them. */
export type RunSource = {
	/** Calls `listener` with the runs whose events landed. Returns the unsubscribe. */
	subscribe(
		listener: (runs: readonly { spaceId: string; runId: string }[]) => void,
	): () => void;
	/** The run now. Null when this Replica has no such run. */
	run(spaceId: string, runId: string): Promise<RunFacts | null>;
	/** The runs that have not ended, at the start. */
	openRuns(): Promise<RunFacts[]>;
};

export function needsThisComputer(run: RunFacts): boolean {
	const here = run.walker.thisDevice || run.device.thisDevice;
	if (!here) return false;
	if (run.status === "running") return true;
	return run.status === "sleeping" && run.wakeAt !== null;
}

/** The engine's runs, in every Space of this Replica. */
export function engineRunSource(
	engine: Pick<Engine, "onRunEvents" | "space">,
	spaces: () => Promise<string[]>,
): RunSource {
	return {
		subscribe: (listener) =>
			engine.onRunEvents((events) => {
				const seen = new Map<string, { spaceId: string; runId: string }>();
				for (const e of events) {
					seen.set(e.runId, { spaceId: e.spaceId, runId: e.runId });
				}
				listener([...seen.values()]);
			}),
		async run(spaceId, runId) {
			try {
				return await engine.space(spaceId).getRun(runId);
			} catch {
				return null;
			}
		},
		async openRuns() {
			const out: RunFacts[] = [];
			for (const spaceId of await spaces()) {
				const runs = await engine.space(spaceId).listRuns();
				out.push(...runs.filter((run) => run.endedAt === null));
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
	/** Reads the runs that need this computer, then follows their events. */
	start(): Promise<void>;
	/** Lets go of the lock and stops following. */
	stop(): void;
	/** Whether the lock is held now. */
	holding(): boolean;
	/** Applies the setting and the runs now. For tests. */
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
	let unsubscribe: (() => void) | null = null;
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

	function check(): void {
		const wanted =
			!stopped && options.lock !== null && options.enabled() && active.size > 0;
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
			unsubscribe = options.runs.subscribe((runs) => {
				enqueue(async () => {
					for (const { spaceId, runId } of runs) {
						const run = await options.runs.run(spaceId, runId);
						if (run && needsThisComputer(run)) active.add(runId);
						else active.delete(runId);
					}
					check();
				});
			});
			timer = setInterval(check, options.checkMs ?? 5_000);
			enqueue(async () => {
				for (const run of await options.runs.openRuns()) {
					if (needsThisComputer(run)) active.add(run.id);
				}
				check();
			});
			await queue;
		},
		stop() {
			stopped = true;
			unsubscribe?.();
			unsubscribe = null;
			if (timer) clearInterval(timer);
			timer = null;
			release();
		},
		holding: () => hold !== null,
		check,
		idle: () => queue,
	};
}
