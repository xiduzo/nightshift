import { useEffect, useRef, useState } from "react";

import type { RunStreamConnection } from "../runs";
import {
	applyRunBatch,
	type EntryFold,
	emptyLiveRun,
	type LiveRun,
	type LiveRunState,
} from "./run-state";
import { type HostApi, useLiveCache } from "./use-live-cache";

export type LiveRunOptions<T> = {
	/** How the screen keeps the transcript entries. */
	entries: EntryFold<T>;
	/**
	 * Stop the stream for now and keep what came. When it is false again
	 * the stream follows on after the last entry, so nothing is read twice.
	 * The phone pauses while the app is in the background.
	 */
	paused?: boolean;
	/** How long items gather before the screen renders them. Default 50 ms. */
	flushMs?: number;
};

/**
 * Follows one run live through the live cache: its steps, its status and
 * its transcript entries, in batches. It reconnects with backoff and hands
 * on each entry once. Lay its steps over the run you read (`mergeSteps`):
 * the run is read again only when a step starts or ends, or the run
 * changes. A new `runId` starts from nothing.
 */
export function useLiveRun<T>(
	host: HostApi,
	runId: string,
	{ entries, paused = false, flushMs }: LiveRunOptions<T>,
): LiveRun<T> {
	const { client, orpc } = host;
	const live = useLiveCache(orpc);
	const fold = useRef(entries);
	useEffect(() => {
		fold.current = entries;
	});
	/** The last entry so far, so a follow after a pause goes on from it. */
	const lastSeq = useRef<{ runId: string; seq: number } | null>(null);
	const [state, setState] = useState<LiveRunState<T>>(() =>
		emptyLiveRun(entries),
	);
	const [connection, setConnection] =
		useState<RunStreamConnection>("connecting");

	useEffect(() => {
		if (paused) return;
		const controller = new AbortController();
		const known = lastSeq.current;
		const afterSeq = known?.runId === runId ? known.seq : undefined;
		if (afterSeq === undefined) setState(emptyLiveRun(fold.current));

		void live.followRun({
			client,
			runId,
			afterSeq,
			signal: controller.signal,
			flushMs,
			// Keep what came in before a pause: the next follow starts after it.
			flushOnStop: true,
			onConnection: setConnection,
			onBatch: (batch) => {
				if (batch.lastSeq !== null) {
					lastSeq.current = { runId, seq: batch.lastSeq };
				}
				setState((current) => applyRunBatch(current, batch, fold.current));
			},
		});

		return () => controller.abort();
	}, [paused, runId, client, live, flushMs]);

	return { ...state, connection };
}
