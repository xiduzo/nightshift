/**
 * The imports of Clone folders running now, by Clone: a run of one Clone
 * never overlaps another of it. It lives as long as the engine.
 */
export type ImportRuns = {
	/** The run of this Clone that is going on, else `run()`, until it ends. */
	once(cloneId: string, run: () => Promise<void>): Promise<void>;
};

export function createImportRuns(): ImportRuns {
	const running = new Map<string, Promise<void>>();
	return {
		once(cloneId, run) {
			const found = running.get(cloneId);
			if (found) return found;
			const next = run().finally(() => running.delete(cloneId));
			running.set(cloneId, next);
			return next;
		},
	};
}
