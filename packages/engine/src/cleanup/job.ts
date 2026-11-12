/**
 * The timer of the scheduled cleanup: one sweep a short while after the
 * engine is ready, then one every `everyMs`. Each sweep runs each of
 * `sweeps` in turn: the run copies, then the run folders. Sweeps never
 * overlap. Every error is caught and logged here, so one that fails does
 * not keep the next from its work: under `bun --hot` one unhandled error
 * stops every timer of the process. The signal (the engine's lifetime)
 * clears the timers. `swept` is told when a round ends: a sweep runs git
 * for every run, so its length depends on the load of this computer.
 */

/** How long after the engine is ready the first sweep starts. */
export const DEFAULT_CLEANUP_DELAY_MS = 60_000;
/** How often the cleanup sweeps. */
export const DEFAULT_CLEANUP_EVERY_MS = 6 * 60 * 60_000;

export function startCleanupJob(options: {
	/** What each sweep cleans up, by what it is: `run copies`. */
	sweeps: Record<string, () => Promise<unknown>>;
	/** Settles when the engine is ready. A rejection means no sweep at all. */
	ready: Promise<unknown>;
	signal: AbortSignal;
	delayMs?: number;
	everyMs?: number;
	/** Called when every sweep of a round ran, also one that failed. Not after the signal stopped the round. */
	swept?: () => void;
}): void {
	const { signal } = options;
	let running = false;
	let first: ReturnType<typeof setTimeout> | undefined;
	let every: ReturnType<typeof setInterval> | undefined;

	async function tick(): Promise<void> {
		if (running || signal.aborted) return;
		running = true;
		try {
			for (const [what, sweep] of Object.entries(options.sweeps)) {
				if (signal.aborted) return;
				try {
					await sweep();
				} catch (error) {
					console.warn(
						`[cleanup] the cleanup of ${what} failed:`,
						error instanceof Error ? error.message : error,
					);
				}
			}
		} finally {
			running = false;
		}
		options.swept?.();
	}

	const stop = () => {
		clearTimeout(first);
		clearInterval(every);
	};
	signal.addEventListener("abort", stop, { once: true });

	options.ready.then(
		() => {
			if (signal.aborted) return;
			first = setTimeout(() => {
				void tick();
				every = setInterval(
					() => void tick(),
					options.everyMs ?? DEFAULT_CLEANUP_EVERY_MS,
				);
				every.unref?.();
			}, options.delayMs ?? DEFAULT_CLEANUP_DELAY_MS);
			first.unref?.();
		},
		() => {},
	);
}
