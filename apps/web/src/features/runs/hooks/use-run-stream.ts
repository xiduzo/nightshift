import {
	followRun,
	type RunStreamConnection,
	type TranscriptEntry,
} from "@nightshift/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { RunStatus, StepSummary } from "@/shared/api";
import { client } from "@/shared/api";
import { runQueries } from "../queries";
import {
	applyEntries,
	emptyRunTranscript,
	type RunTranscript,
} from "../transcript/transcript";

/** Batches deltas so a fast stream or a long replay renders once per frame window. */
const FLUSH_MS = 50;
/** A burst of step items (the replay sends them all) refetches the run once. */
const REFETCH_MS = 300;

/**
 * Follows `runs.watch` for one run (`followRun`: reconnects with backoff,
 * resumes after the last seq, hands on each entry once). A run another
 * device walks streams the same way: the server follows its running step
 * live through the Host. Transcript entries are grouped by step. Status and
 * step items refetch the run, which carries the edge traversals and the cost.
 */
export function useRunStream(runId: string) {
	const queryClient = useQueryClient();
	const [transcript, setTranscript] =
		useState<RunTranscript>(emptyRunTranscript);
	const [steps, setSteps] = useState<ReadonlyMap<string, StepSummary>>(
		() => new Map(),
	);
	const [status, setStatus] = useState<RunStatus | null>(null);
	const [connection, setConnection] =
		useState<RunStreamConnection>("connecting");

	useEffect(() => {
		const controller = new AbortController();
		let pending: TranscriptEntry[] = [];
		let pendingSteps: StepSummary[] = [];
		let flushTimer: ReturnType<typeof setTimeout> | null = null;
		let refetchTimer: ReturnType<typeof setTimeout> | null = null;

		setTranscript(emptyRunTranscript);
		setSteps(new Map());
		setStatus(null);

		const flush = () => {
			flushTimer = null;
			if (pending.length > 0) {
				const batch = pending;
				pending = [];
				setTranscript((state) => applyEntries(state, batch));
			}
			if (pendingSteps.length > 0) {
				const batch = pendingSteps;
				pendingSteps = [];
				setSteps((current) => {
					const next = new Map(current);
					for (const step of batch) next.set(step.id, step);
					return next;
				});
			}
		};
		const scheduleFlush = () => {
			flushTimer ??= setTimeout(flush, FLUSH_MS);
		};
		const scheduleRefetch = () => {
			refetchTimer ??= setTimeout(() => {
				refetchTimer = null;
				void queryClient.invalidateQueries({ queryKey: runQueries.all() });
			}, REFETCH_MS);
		};

		void followRun({
			client,
			runId,
			signal: controller.signal,
			onConnection: setConnection,
			onEntry: (entry) => {
				pending.push(entry);
				scheduleFlush();
			},
			onStep: (step) => {
				pendingSteps.push(step);
				scheduleFlush();
				scheduleRefetch();
			},
			onStatus: (next) => {
				setStatus(next);
				scheduleRefetch();
			},
		});

		return () => {
			controller.abort();
			if (flushTimer) clearTimeout(flushTimer);
			if (refetchTimer) clearTimeout(refetchTimer);
		};
	}, [runId, queryClient]);

	return { transcript, steps, status, connection };
}
