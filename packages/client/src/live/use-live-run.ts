import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { RunStreamConnection } from "../runs";
import { keepRunBatch, keptRunQuery, keptRunSeq } from "./kept-run";
import { type EntryFold, emptyLiveRun, type LiveRun } from "./run-state";
import { type HostApi, useLiveCache } from "./use-live-cache";

export type LiveRunOptions<T> = {
	/** How the screen keeps the transcript entries. Keep it the same object between renders. */
	entries: EntryFold<T>;
	/**
	 * Stop the stream for now and keep what came. When it is false again
	 * the stream follows on after the last entry, so nothing is read twice.
	 * The phone pauses while the app is in the background.
	 */
	paused?: boolean;
	/** How long items gather before the screen renders them. Default 50 ms. */
	flushMs?: number;
	/**
	 * Render on each batch. False keeps the stream on and every entry in
	 * the query client, but the screen does not render for them. When it is
	 * true again, the screen shows all that came. The phone sets it false
	 * while the screen has no focus. Default true.
	 */
	subscribed?: boolean;
};

/**
 * Follows one run live through the live cache: its steps, its status and
 * its transcript entries, in batches. It reconnects with backoff and hands
 * on each entry once. Lay its steps over the run you read (`mergeSteps`):
 * the run is read again only when a step starts or ends, or the run
 * changes. What came stays in the query client for a few minutes
 * (`keptRunQuery`): a new open of the run shows it at once and follows on
 * after the last entry. A new `runId` starts from nothing.
 */
export function useLiveRun<T>(
	host: HostApi,
	runId: string,
	{ entries, paused = false, flushMs, subscribed = true }: LiveRunOptions<T>,
): LiveRun<T> {
	const { client, orpc } = host;
	const live = useLiveCache(orpc);
	const queryClient = useQueryClient();
	const kept = useQuery({ ...keptRunQuery(runId, entries), subscribed });
	const empty = useMemo(() => emptyLiveRun(entries), [entries]);
	const [connection, setConnection] =
		useState<RunStreamConnection>("connecting");

	useEffect(() => {
		if (paused) return;
		const controller = new AbortController();
		void live.followRun({
			client,
			runId,
			afterSeq: keptRunSeq(queryClient, runId, entries),
			signal: controller.signal,
			flushMs,
			// Keep what came in before a stop: the next follow starts after it.
			flushOnStop: true,
			onConnection: setConnection,
			onBatch: (batch) => keepRunBatch(queryClient, runId, entries, batch),
		});

		return () => controller.abort();
	}, [paused, runId, client, live, flushMs, queryClient, entries]);

	return { ...(kept.data?.state ?? empty), connection };
}
