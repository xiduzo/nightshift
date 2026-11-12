import { matchQuery, type QueryClient } from "@tanstack/react-query";

import type { ApiQueryUtils } from "../api";
import { type Change, documentOf, savedBy, staleAfter } from "../changes";
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
 * notifications of Gates that no longer wait and of device waits that ended, drops an answered Gate from
 * the inbox at once, and follows one run's stream in batches. Each app
 * passes in only what differs: its client, and how it shows a
 * notification (`ShownNotifications`).
 */

/**
 * What a screen reads again. `gates`: the open Gates. `run`: one run's
 * detail, its opened steps and its files. `every-run`: the same for every
 * run. `change`: what a change makes stale (`staleAfter`): the lists that
 * count runs, a synced document, the projects of a Space, the schedules,
 * the learnings. The Devices a run can run on or move to do not change
 * with a run.
 */
type Read =
	| { kind: "gates" }
	| { kind: "every-run" }
	| { kind: "run"; runId: string }
	| { kind: "change"; change: Change };

const GATES: Read = { kind: "gates" };
const ofChange = (change: Change): Read => ({ kind: "change", change });
/** A change of one run: the run, and the lists that count it. */
const ofRun = (runId: string): readonly Read[] => [
	{ kind: "run", runId },
	ofChange("runs"),
];

/**
 * A missed stretch of the stream, or an item this screen does not know:
 * the Gates, every run, and every synced document.
 */
const EVERYTHING: readonly Read[] = [
	GATES,
	{ kind: "every-run" },
	...(
		[
			"runs",
			"learnings",
			"flows",
			"flows-history",
			"knowledge",
			"space",
			"device",
			"device-copy",
		] as const
	).map(ofChange),
];

/**
 * What a synced document's name reads again: what its kind makes stale
 * (`flows:<project>` is a `flows` change). A name this screen does not
 * know reads everything.
 */
function readsForDocument(name: string): readonly Read[] {
	const kind = documentOf(name);
	return kind ? [ofChange(kind)] : EVERYTHING;
}

/**
 * What an item of `notifications.watch` reads again. A Gate that opens or
 * closes changes the inbox and the run it waits in. A run that ends or
 * changes changes that run; a Gate that closes with it sends its own
 * `gate-closed`. A run that ends also ends the sync of a knowledge source. An item of a kind this screen does not know reads
 * everything.
 */
function readsAfter(item: NotificationItem): readonly Read[] {
	switch (item.kind) {
		case "run-finished":
		case "run-failed":
			return [...ofRun(item.runId), ofChange("sources")];
		case "run-changed":
		case "device-wait":
		case "wait-ended":
			return ofRun(item.runId);
		case "gate-opened":
		case "gate-closed":
			return [GATES, ...ofRun(item.runId)];
		case "schedules-changed":
			return [ofChange("pause")];
		case "learnings-changed":
			return [ofChange("learnings")];
		case "projects-changed":
			return [ofChange("projects")];
		case "document-changed":
			return readsForDocument(item.name);
		default:
			return EVERYTHING;
	}
}

/** A burst of items (a walk that starts and ends steps, a person who acts) reads once. */
const READ_MS = 300;
/** How often the open Gates are read again while the notifications stream is down. */
const GATES_POLL_MS = 60_000;
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
	 * While the stream is down, it reads the open Gates once a minute.
	 * Meanwhile, each save of this query client that succeeds reads again
	 * what its route wrote (`SAVES`), so a screen needs no read of its own.
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
	 * The person acted on a run on this screen: started, stopped, resumed,
	 * moved it, ran a step again, or sent it a signal. Reads the run again,
	 * with the reads of the stream in the same burst.
	 */
	runActed(runId: string): void;
	/**
	 * Something on this screen changed what is not a save route the cache
	 * sees: a job that ended, or a save through the client itself. Reads
	 * again what the changes make stale, in the same burst as the stream,
	 * so the change and the stream read it once.
	 */
	changed(...changes: Change[]): void;
	/**
	 * Follows one run (`followRun`) and hands on what came in, in batches.
	 * It reads nothing again: the screen lays the steps over what it read
	 * (`mergeSteps`), and the notifications stream says when a step starts
	 * or ends. Resolves when `signal` aborts, or when the run is not found.
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
	const openKey = gates.open().queryKey;
	/** The notifications stream was live before: a new `live` may have missed items. */
	let wasLive = false;
	/** How the screen that follows shows notifications. Null until one follows. */
	let shown: ShownNotifications | null = null;
	/** What the next read reads, and whether it waits already. */
	const pending = {
		gates: false,
		/** Every run: the stream missed a stretch. */
		everyRun: false,
		/** The runs whose detail to read. */
		details: new Set<string>(),
		/** The runs whose opened steps to read. */
		steps: new Set<string>(),
		/** The runs whose files to read. */
		files: new Set<string>(),
		/** What changed: `staleAfter` says what that makes stale. */
		changes: new Set<Change>(),
	};
	let waiting = false;
	/** Stops the poll of the open Gates. Null while the stream is live, or nothing follows. */
	let stopPoll: (() => void) | null = null;

	/** The run has an open Gate that waits for another branch of the run. */
	function holdsGate(runId: string): boolean {
		const open = queryClient.getQueryData<OpenGate[]>(openKey);
		return (
			open?.some((gate) => gate.runId === runId && gate.branchesWork) ?? false
		);
	}

	function invalidate(queryKey: readonly unknown[]) {
		void queryClient.invalidateQueries({ queryKey });
	}

	/** Reads again, once per burst. */
	function read(what: readonly Read[]) {
		for (const one of what) {
			switch (one.kind) {
				case "gates":
					pending.gates = true;
					break;
				case "every-run":
					pending.everyRun = true;
					break;
				case "run":
					// A Gate on hold opens to answers when its run's other branch ends.
					if (holdsGate(one.runId)) pending.gates = true;
					pending.details.add(one.runId);
					pending.steps.add(one.runId);
					pending.files.add(one.runId);
					break;
				case "change":
					pending.changes.add(one.change);
					break;
			}
		}
		if (waiting) return;
		waiting = true;
		schedule(() => {
			waiting = false;
			const { gates: readGates, everyRun } = pending;
			const details = [...pending.details];
			const steps = [...pending.steps];
			const files = [...pending.files];
			const stale = staleAfter(pending.changes);
			pending.gates = false;
			pending.everyRun = false;
			pending.details.clear();
			pending.steps.clear();
			pending.files.clear();
			pending.changes.clear();
			if (readGates) invalidate(gates.all());
			if (everyRun) {
				invalidate(runs.getKey());
				invalidate(runs.stepKey());
				invalidate(runs.artifactsKey());
				invalidate(runs.filesKey());
			} else {
				for (const runId of details) invalidate(runs.getKey(runId));
				for (const runId of steps) invalidate(runs.stepKey(runId));
				for (const runId of files) invalidate(runs.artifactsKey(runId));
				for (const runId of files) invalidate(runs.filesKey(runId));
			}
			for (const path of stale) invalidate([path]);
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
		// A device wait says it all: the Host words it in the person's time zone.
		if (item.kind === "device-wait") {
			return { title: item.title, ...(item.body ? { body: item.body } : {}) };
		}
		try {
			// Read now: what the cache has may be from before the item. This
			// read is the item's read of the open Gates or of the run, so the
			// burst does not read them a second time.
			if (item.kind === "gate-opened") {
				pending.gates = false;
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
				pending.details.delete(item.runId);
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
			case "wait-ended":
				void close(item.key);
				return;
			case "gate-opened":
			case "run-finished":
			case "run-failed":
			case "device-wait":
				if (item.alert) void tell(item);
				return;
		}
	}

	/** Reads the open Gates once a minute: the fallback while the stream is down. */
	function pollGates() {
		stopPoll = schedule(() => {
			read([GATES]);
			pollGates();
		}, GATES_POLL_MS);
	}

	function stopPolling() {
		stopPoll?.();
		stopPoll = null;
	}

	function onConnection(connection: RunStreamConnection) {
		if (connection !== "live") {
			if (!stopPoll) pollGates();
			return;
		}
		stopPolling();
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
			const stopSaves = queryClient.getMutationCache().subscribe((event) => {
				if (event.type !== "updated" || event.action.type !== "success") {
					return;
				}
				// An oRPC mutation's key starts with its route (`["flows", "save"]`).
				const [route] = event.mutation.options.mutationKey ?? [];
				if (!Array.isArray(route)) return;
				const changes = savedBy(route);
				if (changes.length > 0) read(changes.map(ofChange));
			});
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
				stopSaves();
				stopPolling();
			}
		},

		gateAnswered(gate, result) {
			if (!leavesInbox(result)) return;
			queryClient.setQueryData<OpenGate[]>(openKey, (open) =>
				open?.filter(
					(one) => one.runId !== gate.runId || one.stepId !== gate.stepId,
				),
			);
			read([GATES, ...ofRun(gate.runId)]);
			void close(gateKey(gate));
		},

		runActed(runId) {
			read(ofRun(runId));
		},

		changed(...changes) {
			read(changes.map(ofChange));
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
