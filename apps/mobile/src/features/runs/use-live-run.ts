import {
	type AgentMessages,
	applyAgentMessages,
	createGateQueries,
	createRunQueries,
	followRun,
	type RunStatus,
	type RunStreamConnection,
	type StepSummary,
	type TranscriptEntry,
} from "@nightshift/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";

/** Batches a fast stream or a long replay so the screen renders once per window. */
const FLUSH_MS = 100;
/** A burst of step items (each connect sends them all) reads the run once. */
const REFETCH_MS = 300;

/** Whether the app is on screen. iOS ends a stream of an app in the background. */
function useAppActive(): boolean {
	const [active, setActive] = useState(AppState.currentState === "active");
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) =>
			setActive(state === "active"),
		);
		return () => subscription.remove();
	}, []);
	return active;
}

export type LiveRun = {
	/** The steps from the stream, by id. Lay them over the fetched run with `mergeSteps`. */
	steps: ReadonlyMap<string, StepSummary>;
	/** The run's status from the stream, before the run is read again. */
	status: RunStatus | null;
	/** The latest agent message of each step. */
	messages: AgentMessages;
	connection: RunStreamConnection;
};

/**
 * Follows one run live (`followRun`: reconnects with backoff, hands on
 * each entry once). While the app is in the background it stops; when the
 * app comes back it follows on after the last seq it has, so nothing is
 * read twice. Status and step items read the run and its Gates again.
 */
export function useLiveRun(runId: string): LiveRun {
	const { host } = useSignedIn();
	const queryClient = useQueryClient();
	const runQueries = useHostQueries(createRunQueries);
	const gateQueries = useHostQueries(createGateQueries);
	const active = useAppActive();
	const lastSeq = useRef<{ runId: string; seq: number } | null>(null);
	const [live, setLive] = useState<Omit<LiveRun, "connection">>(() => ({
		steps: new Map(),
		status: null,
		messages: new Map(),
	}));
	const [connection, setConnection] =
		useState<RunStreamConnection>("connecting");

	useEffect(() => {
		if (!active) return;
		const controller = new AbortController();
		const known = lastSeq.current;
		const afterSeq = known?.runId === runId ? known.seq : undefined;
		if (afterSeq === undefined) {
			setLive({ steps: new Map(), status: null, messages: new Map() });
		}
		let entries: TranscriptEntry[] = [];
		let steps: StepSummary[] = [];
		let status: RunStatus | null = null;
		let flushTimer: ReturnType<typeof setTimeout> | null = null;
		let refetchTimer: ReturnType<typeof setTimeout> | null = null;

		const flush = () => {
			flushTimer = null;
			const batch = { entries, steps, status };
			entries = [];
			steps = [];
			status = null;
			setLive((current) => {
				let nextSteps = current.steps;
				if (batch.steps.length > 0) {
					const map = new Map(current.steps);
					for (const step of batch.steps) map.set(step.id, step);
					nextSteps = map;
				}
				return {
					steps: nextSteps,
					status: batch.status ?? current.status,
					messages: applyAgentMessages(current.messages, batch.entries),
				};
			});
		};
		const scheduleFlush = () => {
			flushTimer ??= setTimeout(flush, FLUSH_MS);
		};
		const scheduleRefetch = () => {
			refetchTimer ??= setTimeout(() => {
				refetchTimer = null;
				void queryClient.invalidateQueries({ queryKey: runQueries.all() });
				void queryClient.invalidateQueries({ queryKey: gateQueries.all() });
			}, REFETCH_MS);
		};

		void followRun({
			client: host.client,
			runId,
			afterSeq,
			signal: controller.signal,
			onConnection: setConnection,
			onEntry: (entry) => {
				lastSeq.current = { runId, seq: entry.seq };
				entries.push(entry);
				scheduleFlush();
			},
			onStep: (step) => {
				steps.push(step);
				scheduleFlush();
				scheduleRefetch();
			},
			onStatus: (next) => {
				status = next;
				scheduleFlush();
				scheduleRefetch();
			},
		});

		return () => {
			controller.abort();
			if (refetchTimer) clearTimeout(refetchTimer);
			// Keep what came in before the stop: the next follow starts after it.
			if (flushTimer) {
				clearTimeout(flushTimer);
				flush();
			}
		};
	}, [active, runId, host.client, queryClient, runQueries, gateQueries]);

	return { ...live, connection };
}
