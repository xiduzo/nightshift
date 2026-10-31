/**
 * One clock per period, shared by every text that shows a time: "12 min",
 * "0:41". It runs one timer while someone listens, and none when nobody
 * does. A screen does not re-render when it ticks: only what reads it.
 */
export type Ticker = {
	/** The time of the last tick. The same value until the next tick. */
	now(): number;
	/** Listens to each tick. Returns the way to stop. */
	subscribe(listener: () => void): () => void;
	/** Ticks at once: the app came back to the front. */
	tick(): void;
};

type Clock = {
	now(): number;
	every(run: () => void, ms: number): () => void;
};

const SYSTEM_CLOCK: Clock = {
	now: Date.now,
	every(run, ms) {
		const timer = setInterval(run, ms);
		return () => clearInterval(timer);
	},
};

export function createTicker(everyMs: number, clock = SYSTEM_CLOCK): Ticker {
	let now = clock.now();
	let stop: (() => void) | null = null;
	const listeners = new Set<() => void>();

	function tick() {
		now = clock.now();
		for (const listener of listeners) listener();
	}

	return {
		now() {
			// Nobody listened for a while: the last tick is old, read the clock again.
			if (stop === null && clock.now() - now >= everyMs) now = clock.now();
			return now;
		},
		subscribe(listener) {
			listeners.add(listener);
			if (stop === null) {
				stop = clock.every(tick, everyMs);
				if (clock.now() - now >= everyMs) tick();
			}
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0 && stop !== null) {
					stop();
					stop = null;
				}
			};
		},
		tick() {
			if (listeners.size > 0) tick();
		},
	};
}
