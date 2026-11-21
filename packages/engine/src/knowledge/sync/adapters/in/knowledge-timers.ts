/**
 * The timers of the knowledge: from `connect` on, this Device keeps its
 * folders in step on its own. It imports nothing of the slice: the wire
 * hands it the bound use cases.
 */

/** When this Device keeps its folders in step on its own, from `connect` on. */
export const TIMERS = {
	/** Every folder, once the Links had a moment to come up: the import on upgrade (ADR 4, decision 10), and what changed while the daemon was down. */
	firstReconcileMs: 15_000,
	/** The folders whose content still waits for its Host. */
	retryMs: 60_000,
	/** The content of the Spaces this Device keeps that no document lists any more. */
	firstCollectMs: 60 * 60_000,
	collectMs: 24 * 60 * 60_000,
	/** The size of each knowledge document, for the anonymous usage. */
	firstMeasureMs: 60 * 60_000,
	measureMs: 24 * 60 * 60_000,
};

/** When the timers run: `TIMERS`, or other times for a test. */
export type KnowledgeTimes = typeof TIMERS;

/** Starts the timers. Returns what stops them. */
export function startKnowledgeTimers(
	cases: {
		reconcileAll(): Promise<void>;
		retryPending(): Promise<void>;
		/** The collection, or nothing when no Host tells which Spaces this Replica keeps. */
		collect(): Promise<unknown> | undefined;
		measure(): Promise<void>;
	},
	given: Partial<KnowledgeTimes> = {},
): () => void {
	const times = { ...TIMERS, ...given };
	const first = setTimeout(() => {
		cases.reconcileAll().catch((error) => {
			console.warn("The knowledge was not brought in step:", error);
		});
	}, times.firstReconcileMs);
	const retry = setInterval(() => {
		cases.retryPending().catch(() => {});
	}, times.retryMs);
	const collectNow = () => {
		cases.collect()?.catch((error) => {
			console.warn("The old knowledge content was not removed:", error);
		});
	};
	const firstCollect = setTimeout(collectNow, times.firstCollectMs);
	const collect = setInterval(collectNow, times.collectMs);
	const measureNow = () => {
		cases.measure().catch((error) => {
			console.warn("The knowledge documents were not measured:", error);
		});
	};
	const firstMeasure = setTimeout(measureNow, times.firstMeasureMs);
	const measure = setInterval(measureNow, times.measureMs);
	for (const timer of [
		first,
		retry,
		firstCollect,
		collect,
		firstMeasure,
		measure,
	]) {
		timer.unref();
	}
	return () => {
		clearTimeout(first);
		clearInterval(retry);
		clearTimeout(firstCollect);
		clearInterval(collect);
		clearTimeout(firstMeasure);
		clearInterval(measure);
	};
}
