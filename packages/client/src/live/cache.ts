import type { QueryClient } from "@tanstack/react-query";

import type { ApiQueryUtils } from "../api";
import { createGateQueries, type OpenGate } from "../gates";
import type { NotificationItem } from "../notifications";
import {
	followRun,
	type RunStreamConnection,
	type RunWatchClient,
	type Wait,
} from "../runs";
import {
	createRunStreamBuffer,
	type RunStreamBatch,
	type Schedule,
	timerSchedule,
} from "./run-buffer";

/** What a screen reads again: the open Gates, the runs. */
type Read = "gates" | "runs";

/** A missed stretch of a stream, an answer, a step or status of a run: read both. */
const EVERYTHING: readonly Read[] = ["gates", "runs"];

/**
 * What an item of `notifications.watch` reads again. A Gate that opens or
 * closes changes the inbox and the run it waits in. A run that ends changes
 * the runs; a Gate that closes with it sends its own `gate-closed`. An item
 * this screen does not know yet reads both.
 */
function readsAfter(item: NotificationItem): readonly Read[] {
	switch (item.kind) {
		case "run-finished":
		case "run-failed":
			return ["runs"];
		default:
			return EVERYTHING;
	}
}

/** A burst of step and status items of one run reads the runs and Gates again once. */
const REFETCH_MS = 300;
const DEFAULT_FLUSH_MS = 50;

export type LiveCacheOptions = {
	queryClient: QueryClient;
	orpc: ApiQueryUtils;
	/** The timers of a run's batches. Tests pass one they run by hand. */
	schedule?: Schedule;
};

export type FollowLiveRunOptions = {
	client: RunWatchClient;
	runId: string;
	/** The seq the caller has already, from an earlier follow of this run. */
	afterSeq?: number;
	/** Stops the stream. `followRun` resolves soon after. */
	signal: AbortSignal;
	/** What came in, once per flush window. */
	onBatch(batch: RunStreamBatch): void;
	onConnection?(connection: RunStreamConnection): void;
	/** How long items gather before one batch. Default 50 ms. */
	flushMs?: number;
	/** On abort, hand on what gathered (to keep it for the next follow). Default false: drop it. */
	flushOnStop?: boolean;
	wait?: Wait;
};

/** What a screen reads again when a stream says something changed. One per query client and Host. */
export type LiveCache = {
	/** An item of `notifications.watch`: reads again what it changes. */
	onNotification(item: NotificationItem): void;
	/**
	 * The state of the notifications stream. Each `live` after the first
	 * reads the Gates and runs again: items of the time it was down are lost.
	 */
	onNotificationsConnection(connection: RunStreamConnection): void;
	/**
	 * This screen answered a Gate, or Night Shift refused the answer as
	 * closed or not found: out of the inbox at once, then the Gates and runs
	 * are read again to confirm.
	 */
	afterGateAnswered(gate: { runId: string; stepId: string }): void;
	/**
	 * Follows one run (`followRun`) and hands on what came in, in batches.
	 * Step and status items read the runs and Gates again, once per burst.
	 * Resolves when `signal` aborts.
	 */
	followRun(options: FollowLiveRunOptions): Promise<void>;
};

export function createLiveCache({
	queryClient,
	orpc,
	schedule = timerSchedule,
}: LiveCacheOptions): LiveCache {
	const gates = createGateQueries(orpc);
	const keys: Record<Read, () => readonly unknown[]> = {
		gates: gates.all,
		runs: () => orpc.runs.key(),
	};
	/** The notifications stream was live before: a new `live` may have missed items. */
	let wasLive = false;

	function read(what: readonly Read[]) {
		for (const one of what) {
			void queryClient.invalidateQueries({ queryKey: keys[one]() });
		}
	}

	return {
		onNotification(item) {
			read(readsAfter(item));
		},
		onNotificationsConnection(connection) {
			if (connection !== "live") return;
			if (wasLive) read(EVERYTHING);
			wasLive = true;
		},
		afterGateAnswered(gate) {
			queryClient.setQueryData<OpenGate[]>(gates.open().queryKey, (open) =>
				open?.filter(
					(one) => one.runId !== gate.runId || one.stepId !== gate.stepId,
				),
			);
			read(EVERYTHING);
		},
		async followRun({
			onBatch,
			flushMs = DEFAULT_FLUSH_MS,
			flushOnStop = false,
			...follow
		}) {
			const buffer = createRunStreamBuffer({
				flushMs,
				refetchMs: REFETCH_MS,
				schedule,
				lastSeq: follow.afterSeq ?? null,
				onFlush: onBatch,
				onRunChanged: () => read(EVERYTHING),
			});
			const stop = () => buffer.stop({ flush: flushOnStop });
			follow.signal.addEventListener("abort", stop, { once: true });
			try {
				await followRun({
					...follow,
					onEntry: buffer.entry,
					onStep: buffer.step,
					onStatus: buffer.status,
				});
			} finally {
				stop();
			}
		},
	};
}
