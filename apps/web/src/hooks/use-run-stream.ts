import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { RunStatus, TranscriptEntry } from "@/lib/api-types";
import {
	applyEntries,
	emptyTranscript,
	type TranscriptState,
} from "@/lib/transcript";
import { client, orpc } from "@/utils/orpc";

export type StreamConnection = "connecting" | "live" | "reconnecting";

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15_000;
/** Batches deltas so a fast stream or a long replay renders once per frame window. */
const FLUSH_MS = 50;

/**
 * Subscribes to `runs.watch` for one run. The server replays the transcript
 * from disk, then streams live items. When the stream drops, the hook
 * reconnects with backoff and passes the last seen seq as `afterSeq`, so it
 * only receives entries it does not have yet. A status item refetches the run.
 */
export function useRunStream(runId: string) {
	const queryClient = useQueryClient();
	const [transcript, setTranscript] =
		useState<TranscriptState>(emptyTranscript);
	const [status, setStatus] = useState<RunStatus | null>(null);
	const [connection, setConnection] = useState<StreamConnection>("connecting");

	useEffect(() => {
		const controller = new AbortController();
		const { signal } = controller;
		let lastSeq: number | undefined;
		let pending: TranscriptEntry[] = [];
		let flushTimer: ReturnType<typeof setTimeout> | null = null;

		setTranscript(emptyTranscript);
		setStatus(null);
		setConnection("connecting");

		const flush = () => {
			flushTimer = null;
			if (pending.length === 0) return;
			const batch = pending;
			pending = [];
			setTranscript((state) => applyEntries(state, batch));
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
						if (item.kind === "transcript") {
							if (lastSeq !== undefined && item.entry.seq <= lastSeq) continue;
							lastSeq = item.entry.seq;
							pending.push(item.entry);
							flushTimer ??= setTimeout(flush, FLUSH_MS);
						} else {
							setStatus(item.status);
							void queryClient.invalidateQueries({
								queryKey: orpc.runs.key(),
							});
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
		};
	}, [runId, queryClient]);

	return { transcript, status, connection };
}
