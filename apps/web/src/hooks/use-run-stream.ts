import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { RunStatus, StepSummary, TranscriptEntry } from "@/lib/api-types";
import {
	applyEntries,
	emptyRunTranscript,
	type RunTranscript,
} from "@/lib/transcript";
import { client, orpc } from "@/utils/orpc";

export type StreamConnection = "connecting" | "live" | "reconnecting";

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15_000;
/** Batches deltas so a fast stream or a long replay renders once per frame window. */
const FLUSH_MS = 50;
/** A burst of step items (the replay sends them all) refetches the run once. */
const REFETCH_MS = 300;

/**
 * Subscribes to `runs.watch` for one run. The server sends the status and
 * every step summary, replays the transcript from disk, then streams live
 * items. Transcript entries are grouped by step. When the stream drops, the
 * hook reconnects with backoff and passes the last seen seq as `afterSeq`, so
 * it only receives entries it does not have yet. Status and step items
 * refetch the run, which carries the edge traversals and the cost.
 */
export function useRunStream(runId: string) {
	const queryClient = useQueryClient();
	const [transcript, setTranscript] =
		useState<RunTranscript>(emptyRunTranscript);
	const [steps, setSteps] = useState<ReadonlyMap<string, StepSummary>>(
		() => new Map(),
	);
	const [status, setStatus] = useState<RunStatus | null>(null);
	const [connection, setConnection] = useState<StreamConnection>("connecting");

	useEffect(() => {
		const controller = new AbortController();
		const { signal } = controller;
		let lastSeq: number | undefined;
		let pending: TranscriptEntry[] = [];
		let pendingSteps: StepSummary[] = [];
		let flushTimer: ReturnType<typeof setTimeout> | null = null;
		let refetchTimer: ReturnType<typeof setTimeout> | null = null;

		setTranscript(emptyRunTranscript);
		setSteps(new Map());
		setStatus(null);
		setConnection("connecting");

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
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			}, REFETCH_MS);
		};

		const run = async () => {
			let attempt = 0;
			while (!signal.aborted) {
				try {
					const stream = await client.runs.watch(
						{ runId, afterSeq: lastSeq },
						{ signal },
					);
					setConnection("live");
					for await (const item of stream) {
						attempt = 0;
						switch (item.kind) {
							case "transcript":
								if (lastSeq !== undefined && item.entry.seq <= lastSeq) break;
								lastSeq = item.entry.seq;
								pending.push(item.entry);
								scheduleFlush();
								break;
							case "step":
								pendingSteps.push(item.step);
								scheduleFlush();
								scheduleRefetch();
								break;
							case "status":
								setStatus(item.status);
								scheduleRefetch();
								break;
						}
					}
				} catch {
					// Dropped connection or server error: fall through to the retry.
				}
				if (signal.aborted) return;
				setConnection("reconnecting");
				const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
				attempt += 1;
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, delay);
					signal.addEventListener(
						"abort",
						() => {
							clearTimeout(timer);
							resolve();
						},
						{ once: true },
					);
				});
			}
		};

		void run();

		return () => {
			controller.abort();
			if (flushTimer) clearTimeout(flushTimer);
			if (refetchTimer) clearTimeout(refetchTimer);
		};
	}, [runId, queryClient]);

	return { transcript, steps, status, connection };
}

/**
 * The run's steps: the fetched list, with the live summaries from the stream
 * laid over it, in the order they started.
 */
export function mergeSteps(
	fetched: readonly StepSummary[],
	live: ReadonlyMap<string, StepSummary>,
): StepSummary[] {
	const byId = new Map(fetched.map((step) => [step.id, step]));
	for (const [id, step] of live) byId.set(id, step);
	return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}
