/**
 * The ticker of the scheduler: the driving adapter of the clock. It asks
 * for one look at every tick (and one at start), and holds no rule of
 * schedules. The wire hands it the look (`fire`).
 *
 * What it keeps: ticks never overlap, a stop ends the ticks for good, and
 * a hold lets no look start a run until its release.
 */

/** How often the scheduler looks for due schedules, unless the engine says otherwise. */
export const DEFAULT_SCHEDULE_TICK_MS = 30_000;

/** What one look may ask of the ticker while it runs. */
export type ScheduleTick = {
	/** Whether a hold is on. */
	held(): boolean;
	/** Whether the ticker stopped. */
	stopped(): boolean;
};

export type ScheduleTickerDeps = {
	tickMs: number;
	/** One look over every project (`fireDueSchedules`, bound to its ports). */
	fire(tick: ScheduleTick): Promise<void>;
};

export type ScheduleTicker = {
	/** Ticks now and then every `tickMs`, until `stop` or the signal aborts. */
	start(signal?: AbortSignal): void;
	stop(): void;
	/** One look. Ticks never overlap: a second call waits for the running one. */
	tick(): Promise<void>;
	/**
	 * Holds the looks: none starts a run until the release. Resolves once
	 * the look under way ended, so its runs are in the log. The release
	 * ticks at once when the ticker runs, and is safe to call twice.
	 */
	hold(): Promise<() => void>;
};

export function createScheduleTicker(deps: ScheduleTickerDeps): ScheduleTicker {
	let running: Promise<void> | null = null;
	let timer: ReturnType<typeof setInterval> | undefined;
	let stopped = false;
	/** How many holds are not released. */
	let holds = 0;

	const state: ScheduleTick = {
		held: () => holds > 0,
		stopped: () => stopped,
	};

	function tick(): Promise<void> {
		if (running) return running;
		running = deps
			.fire(state)
			.catch((error) => {
				if (!stopped)
					console.error("[nightshift] The scheduler tick failed:", error);
			})
			.finally(() => {
				running = null;
			});
		return running;
	}

	function stop(): void {
		stopped = true;
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
	}

	return {
		start(signal) {
			if (stopped || timer !== undefined) return;
			if (signal?.aborted) {
				stop();
				return;
			}
			signal?.addEventListener("abort", stop, { once: true });
			timer = setInterval(() => void tick(), deps.tickMs);
			// The HTTP server keeps the daemon alive. A test may end without stopping it.
			(timer as { unref?: () => void }).unref?.();
			void tick();
		},
		stop,
		tick,
		async hold() {
			holds++;
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				holds--;
				if (holds === 0 && timer !== undefined) void tick();
			};
			await running;
			return release;
		},
	};
}
