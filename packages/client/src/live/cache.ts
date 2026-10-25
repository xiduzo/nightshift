import { matchQuery, type QueryClient } from "@tanstack/react-query";

import type { ApiQueryUtils } from "../api";
import { createDashboardQueries } from "../dashboard";
import {
	createGateQueries,
	type GateAnswer,
	type GateAnswerResult,
	leavesInbox,
	type OpenGate,
} from "../gates";
import {
	describeNotice,
	followNotifications,
	gateKey,
	type NotificationItem,
	type NotificationWatchClient,
	type PushData,
	routeOf,
	staleGates,
} from "../notifications";
import {
	createRunQueries,
	followRun,
	type RunStreamConnection,
	type RunWatchClient,
	type Wait,
} from "../runs";
import { createScheduleQueries } from "../schedules";
import {
	createRunStreamBuffer,
	type RunStreamBatch,
	type Schedule,
	timerSchedule,
} from "./run-buffer";
import type { Notice, ShownNotifications } from "./shown";

/**
 * The live cache: what a screen knows of its Host, kept up to date. It is
 * the one follower of the Host's streams for both apps. It follows the
 * notifications stream (and reconnects), reads again what each item
 * changes, shows a notice for an item that alerts, takes away the
 * notifications of Gates that no longer wait, drops an answered Gate from
 * the inbox at once, and follows one run's stream in batches. Each app
 * passes in only what differs: its client, and how it shows a
 * notification (`ShownNotifications`).
 */

/** What a screen reads again: the open Gates, or what comes from the runs. */
type Read = "gates" | "runs";

/** A missed stretch of a stream, an answer, a Gate, a step or status of a run: read both. */
const EVERYTHING: readonly Read[] = ["gates", "runs"];

/**
 * What an item of `notifications.watch` reads again. A Gate that opens or
 * closes changes the inbox and the run it waits in. A run that ends or
 * changes changes the runs; a Gate that closes with it sends its own
 * `gate-closed`. An item of a kind this screen does not know reads both.
 */
function readsAfter(item: NotificationItem): readonly Read[] {
	switch (item.kind) {
		case "run-finished":
		case "run-failed":
		case "run-changed":
			return ["runs"];
		default:
			return EVERYTHING;
	}
}

/** A burst of items (each connect of a run's stream sends every step) reads once. */
const READ_MS = 300;
const DEFAULT_FLUSH_MS = 50;

export type LiveCacheOptions = {
	queryClient: QueryClient;
	orpc: ApiQueryUtils;
	/** The timers of the reads and of a run's batches. Tests pass one they run by hand. */
	schedule?: Schedule;
	/** How to wait before a stream tries again. Tests pass one that does not wait. */
	wait?: Wait;
};

export type FollowHostOptions = {
	client: NotificationWatchClient;
	/** How this screen shows a notice and takes notifications away. */
	shown: ShownNotifications;
	/** The phone app: it stops following when it leaves the front. */
	phone?: boolean;
	/** Stops following. `followHost` resolves soon after. */
	signal: AbortSignal;
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
};

/** What a screen knows of its Host, kept up to date. One per query client and Host. */
export type LiveCache = {
	/**
	 * Follows the Host's notifications stream until `signal` aborts, and
	 * reconnects after a drop. Each item reads again what it changes. An
	 * item with `alert` shows a notice; a closed Gate takes its
	 * notifications away. Each read of the open Gates takes away the
	 * notifications of Gates that no longer wait. Each `live` after the
	 * first reads everything again: items of the time it was down are lost.
	 */
	followHost(options: FollowHostOptions): Promise<void>;
	/**
	 * What came of an answer to a Gate on this screen. When the Gate leaves
	 * the inbox (`leavesInbox`: the answer went, or the Gate is closed or not
	 * found), it leaves it at once, its notifications go, and the Gates and
	 * runs are read again to confirm.
	 */
	gateAnswered(gate: GateAnswer, result: GateAnswerResult): void;
	/**
	 * Follows one run (`followRun`) and hands on what came in, in batches.
	 * Step and status items read the runs and Gates again, once per burst.
	 * Resolves when `signal` aborts, or when the run is not found.
	 */
	followRun(options: FollowLiveRunOptions): Promise<void>;
};

export function createLiveCache({
	queryClient,
	orpc,
	schedule = timerSchedule,
	wait,
}: LiveCacheOptions): LiveCache {
	const gates = createGateQueries(orpc);
	const runs = createRunQueries(orpc);
	const keys: Record<Read, readonly (() => readonly unknown[])[]> = {
		gates: [gates.all],
		// What comes from the runs: the dashboard's numbers, a schedule's last start.
		runs: [
			runs.all,
			createDashboardQueries(orpc).all,
			createScheduleQueries(orpc).all,
		],
	};
	const openKey = gates.open().queryKey;
	/** The notifications stream was live before: a new `live` may have missed items. */
	let wasLive = false;
	/** How the screen that follows shows notifications. Null until one follows. */
	let shown: ShownNotifications | null = null;
	/** What the next read reads, and whether it waits already. */
	const pending = new Set<Read>();
	let waiting = false;

	/** Reads again, once per burst. */
	function read(what: readonly Read[]) {
		for (const one of what) pending.add(one);
		if (waiting) return;
		waiting = true;
		schedule(() => {
			waiting = false;
			const due = [...pending];
			pending.clear();
			for (const one of due) {
				for (const key of keys[one]) {
					void queryClient.invalidateQueries({ queryKey: key() });
				}
			}
		}, READ_MS);
	}

	/** Takes away the shown Gate notifications whose Gate this read of the open Gates misses. */
	async function clearStale(open: readonly OpenGate[], readAt: number) {
		const screen = shown;
		if (!screen) return;
		try {
			const listed = await screen.list();
			const openKeys = new Set(open.map(gateKey));
			for (const stale of staleGates(listed, openKeys, readAt)) {
				await stale.dismiss();
			}
		} catch {
			// The next read of the open Gates tries again.
		}
	}

	async function close(key: string) {
		try {
			await shown?.close(key);
		} catch {
			// The next read of the open Gates takes it away.
		}
	}

	/** The longer words of a notice: the Gate or the run, read from the Host. */
	async function describe(
		item: Extract<NotificationItem, { alert: boolean }>,
	): Promise<{ title: string; body?: string }> {
		try {
			// Read now: what the cache has may be from before the item.
			if (item.kind === "gate-opened") {
				const open = await queryClient.fetchQuery({
					...gates.open(),
					staleTime: 0,
				});
				const gate = open.find(
					(one) => one.runId === item.runId && one.stepId === item.stepId,
				);
				if (gate) return describeNotice({ kind: item.kind, gate });
			} else {
				// By its id: a run of any of the person's Spaces.
				const run = await queryClient.fetchQuery({
					...runs.get(item.runId),
					staleTime: 0,
				});
				return describeNotice({ kind: item.kind, run });
			}
		} catch {
			// The short sentence of the item is enough.
		}
		return { title: item.title };
	}

	async function tell(item: Extract<NotificationItem, { alert: boolean }>) {
		const data: PushData = {
			kind: item.kind,
			key: item.key,
			spaceId: item.spaceId,
			runId: item.runId,
			stepId: item.stepId,
		};
		const notice: Notice = {
			data,
			route: routeOf(data),
			title: item.title,
			describe: () => describe(item),
		};
		try {
			await shown?.show(notice);
		} catch {
			// A notice that did not show is not worth a retry.
		}
	}

	function onItem(item: NotificationItem) {
		read(readsAfter(item));
		switch (item.kind) {
			case "gate-closed":
				void close(item.key);
				return;
			case "gate-opened":
			case "run-finished":
			case "run-failed":
				if (item.alert) void tell(item);
				return;
		}
	}

	function onConnection(connection: RunStreamConnection) {
		if (connection !== "live") return;
		if (wasLive) read(EVERYTHING);
		wasLive = true;
	}

	return {
		async followHost({ client, shown: screen, phone = false, signal }) {
			shown = screen;
			const stop = queryClient.getQueryCache().subscribe((event) => {
				if (event.type !== "updated" || event.action.type !== "success") {
					return;
				}
				if (!matchQuery({ queryKey: openKey, exact: true }, event.query)) {
					return;
				}
				const { data, dataUpdatedAt } = event.query.state;
				if (data) void clearStale(data as OpenGate[], dataUpdatedAt);
			});
			const known = queryClient.getQueryState<OpenGate[]>(openKey);
			if (known?.data) void clearStale(known.data, known.dataUpdatedAt);
			try {
				await followNotifications({
					client,
					phone,
					signal,
					onItem,
					onConnection,
					...(wait ? { wait } : {}),
				});
			} finally {
				stop();
			}
		},

		gateAnswered(gate, result) {
			if (!leavesInbox(result)) return;
			queryClient.setQueryData<OpenGate[]>(openKey, (open) =>
				open?.filter(
					(one) => one.runId !== gate.runId || one.stepId !== gate.stepId,
				),
			);
			read(EVERYTHING);
			void close(gateKey(gate));
		},

		async followRun({
			onBatch,
			flushMs = DEFAULT_FLUSH_MS,
			flushOnStop = false,
			...follow
		}) {
			const buffer = createRunStreamBuffer({
				flushMs,
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
					...(wait ? { wait } : {}),
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
