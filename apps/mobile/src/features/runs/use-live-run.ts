import {
	type AgentMessages,
	applyAgentMessages,
	type RunStatus,
	type RunStreamConnection,
	type StepSummary,
	useLiveCache,
} from "@nightshift/client";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useSignedIn } from "@/features/host";

/** Batches a fast stream or a long replay so the screen renders once per window. */
const FLUSH_MS = 100;

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
 * Follows one run live through the live cache (`followRun`: reconnects with
 * backoff, hands on each entry once, in batches of 100 ms). While the app
 * is in the background it stops, and keeps what came in before the stop;
 * when the app comes back it follows on after the last seq it has, so
 * nothing is read twice. Status and step items read the run and its Gates
 * again.
 */
export function useLiveRun(runId: string): LiveRun {
	const { host } = useSignedIn();
	const live = useLiveCache(host.orpc);
	const active = useAppActive();
	const lastSeq = useRef<{ runId: string; seq: number } | null>(null);
	const [state, setState] = useState<Omit<LiveRun, "connection">>(() => ({
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
			setState({ steps: new Map(), status: null, messages: new Map() });
		}

		void live.followRun({
			client: host.client,
			runId,
			afterSeq,
			signal: controller.signal,
			flushMs: FLUSH_MS,
			// Keep what came in before the stop: the next follow starts after it.
			flushOnStop: true,
			onConnection: setConnection,
			onBatch: (batch) => {
				if (batch.lastSeq !== null) {
					lastSeq.current = { runId, seq: batch.lastSeq };
				}
				setState((current) => {
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
			},
		});

		return () => controller.abort();
	}, [active, runId, host.client, live]);

	return { ...state, connection };
}
