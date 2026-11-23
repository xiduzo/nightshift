/** What the ticker runs, and when it does nothing. */
export type TickerOptions = {
	/** How often, in ms. */
	everyMs: number;
	/** The notifier stopped: a tick does nothing. */
	stopped(): boolean;
	/** Puts the checks in the notifier's queue. */
	tick(): void;
};

/**
 * The notifier's timer: every `everyMs` it puts the checks in the queue
 * (held pushes, the end of quiet hours), unless the notifier stopped.
 * Returns the stop of the timer.
 */
export function startTicker(options: TickerOptions): () => void {
	const timer = setInterval(() => {
		if (!options.stopped()) options.tick();
	}, options.everyMs);
	return () => clearInterval(timer);
}
