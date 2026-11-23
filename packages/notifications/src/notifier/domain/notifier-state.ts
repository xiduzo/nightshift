/**
 * The state the notifier keeps while it runs: the one queue every piece
 * of work waits in, the "N Gates wait for you" pushes still out, and when
 * it last pruned the log. Pure: the time comes in as an argument.
 */

/** How often held pushes and the end of quiet hours are checked. */
export const DEFAULT_TICK_MS = 15_000;

/** How often the notifier removes the entries the inbox no longer keeps. */
export const PRUNE_EVERY_MS = 60 * 60_000;

/**
 * One piece of work after the other, so two landings never race. A job
 * that fails goes to `onError` with what it was, and the next one runs.
 */
export function createSerialQueue(
	onError: (what: string, error: unknown) => void,
) {
	let queue: Promise<void> = Promise.resolve();
	return {
		enqueue(what: string, job: () => Promise<void>): Promise<void> {
			queue = queue.then(job).catch((error) => onError(what, error));
			return queue;
		},
		/** Resolves once every piece of work so far is done. */
		idle: () => queue,
	};
}

/** One "N Gates wait for you" push that went out to one screen. */
export type Bundle = { targetId: string; key: string; gates: Set<string> };

/**
 * The "N Gates wait for you" pushes that went out, and the Gates each one
 * still names: the last Gate's close withdraws it. Only in memory: after
 * a restart the screens clear it themselves when no Gate waits.
 */
export function createBundles() {
	const bundles: Bundle[] = [];
	return {
		add(bundle: Bundle) {
			bundles.push(bundle);
		},
		/** The Gate of `key` closed: the bundles it was the last Gate of. They are gone from here. */
		closed(key: string): Bundle[] {
			const done: Bundle[] = [];
			for (const bundle of [...bundles]) {
				if (!bundle.gates.delete(key) || bundle.gates.size > 0) continue;
				bundles.splice(bundles.indexOf(bundle), 1);
				done.push(bundle);
			}
			return done;
		},
	};
}

/** When the log is pruned: at most once every `PRUNE_EVERY_MS`. */
export function createPruneClock() {
	let prunedAt = Number.NEGATIVE_INFINITY;
	return {
		/** Whether a prune is due at `at`. True also marks it done. */
		due(at: number): boolean {
			if (at - prunedAt < PRUNE_EVERY_MS) return false;
			prunedAt = at;
			return true;
		},
	};
}
