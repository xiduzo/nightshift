/**
 * The waits of a Device's calls to its Hosts: one `pause` and one
 * `backoff`, so every loop over a Link waits the same way.
 */

/** Resolves after `ms`, or at once when `signal` aborts. Never rejects. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}

/** Waits that double after each failure. */
export type Backoff = {
	/** The wait before the next try: `firstMs`, then double, up to `maxMs`. */
	next(): number;
	/** After a success: the next wait is `firstMs` again. */
	reset(): void;
};

export function backoff(policy: { firstMs: number; maxMs: number }): Backoff {
	let failures = 0;
	return {
		next() {
			const ms = Math.min(policy.maxMs, policy.firstMs * 2 ** failures);
			failures++;
			return ms;
		},
		reset() {
			failures = 0;
		},
	};
}
