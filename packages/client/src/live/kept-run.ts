import {
	type QueryClient,
	queryOptions,
	skipToken,
} from "@tanstack/react-query";

import type { RunStreamBatch } from "./run-buffer";
import {
	applyRunBatch,
	type EntryFold,
	emptyLiveRun,
	type LiveRunState,
} from "./run-state";

/**
 * How long the query client keeps what came on a run's stream after its
 * screen closes. A new open within that time shows it at once, and the
 * stream follows on after the last entry.
 */
export const KEPT_RUN_MS = 5 * 60 * 1000;

/** What came on one run's stream, kept one screen's way, and the seq of its last entry. */
export type KeptRun<T> = { state: LiveRunState<T>; lastSeq: number | null };

/** One id per fold: the web groups the entries by step, the phone another way. */
const foldIds = new WeakMap<object, number>();
let nextFoldId = 0;

function foldId(fold: EntryFold<unknown>): number {
	let id = foldIds.get(fold);
	if (id === undefined) {
		id = nextFoldId++;
		foldIds.set(fold, id);
	}
	return id;
}

/**
 * The query of what a screen keeps of one run's stream, per run and per
 * fold. It reads nothing: `keepRunBatch` writes it. Keep the fold the
 * same object between renders.
 */
export function keptRunQuery<T>(runId: string, fold: EntryFold<T>) {
	return queryOptions<KeptRun<T>>({
		queryKey: ["live-run", runId, foldId(fold as EntryFold<unknown>)],
		queryFn: skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: KEPT_RUN_MS,
		// Thousands of entries: comparing them on each batch costs more than it saves.
		structuralSharing: false,
	});
}

/** The seq a new follow of the run starts after: the last entry kept, if any. */
export function keptRunSeq<T>(
	queryClient: QueryClient,
	runId: string,
	fold: EntryFold<T>,
): number | undefined {
	const kept = queryClient.getQueryData(keptRunQuery(runId, fold).queryKey);
	return kept?.lastSeq ?? undefined;
}

/**
 * Lays one batch over what the query client keeps of the run. An entry at
 * or before the last kept seq came already (another follow of the same
 * run), and goes.
 */
export function keepRunBatch<T>(
	queryClient: QueryClient,
	runId: string,
	fold: EntryFold<T>,
	batch: RunStreamBatch,
): void {
	const options = keptRunQuery(runId, fold);
	// Made with its own gcTime, also when no screen watches it.
	const { queryKey, queryFn, gcTime, structuralSharing } = options;
	queryClient.getQueryCache().build(queryClient, {
		queryKey: queryKey as readonly unknown[],
		queryFn,
		gcTime,
		structuralSharing,
	});
	queryClient.setQueryData(options.queryKey, (kept) => {
		const known = kept?.lastSeq ?? null;
		const entries =
			known === null
				? batch.entries
				: batch.entries.filter((entry) => entry.seq > known);
		const lastSeq = Math.max(known ?? -1, batch.lastSeq ?? -1);
		return {
			state: applyRunBatch(
				kept?.state ?? emptyLiveRun(fold),
				{ ...batch, entries },
				fold,
			),
			lastSeq: lastSeq < 0 ? null : lastSeq,
		};
	});
}
