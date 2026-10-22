import { type RunStreamConnection, useLiveCache } from "@nightshift/client";
import { useEffect, useState } from "react";

import type { RunStatus, StepSummary } from "@/shared/api";
import { client, orpc } from "@/shared/api";
import {
	applyEntries,
	emptyRunTranscript,
	type RunTranscript,
} from "../transcript/transcript";

/**
 * Follows `runs.watch` for one run through the live cache (`followRun`:
 * reconnects with backoff, resumes after the last seq, hands on each entry
 * once, in batches of 50 ms so a fast stream or a long replay renders once
 * per window). A run another device walks streams the same way: the server
 * follows its running step live through the Host. Transcript entries are
 * grouped by step. Status and step items read the run and the Gates again,
 * which carry the edge traversals and the cost.
 */
export function useRunStream(runId: string) {
	const live = useLiveCache(orpc);
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
		setTranscript(emptyRunTranscript);
		setSteps(new Map());
		setStatus(null);

		void live.followRun({
			client,
			runId,
			signal: controller.signal,
			onConnection: setConnection,
			onBatch: (batch) => {
				if (batch.entries.length > 0) {
					setTranscript((state) => applyEntries(state, batch.entries));
				}
				if (batch.steps.length > 0) {
					setSteps((current) => {
						const next = new Map(current);
						for (const step of batch.steps) next.set(step.id, step);
						return next;
					});
				}
				if (batch.status !== null) setStatus(batch.status);
			},
		});

		return () => controller.abort();
	}, [runId, live]);

	return { transcript, steps, status, connection };
}
