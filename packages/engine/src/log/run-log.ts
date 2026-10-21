import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import {
	appendEvent,
	type EngineEventType,
	type EventInput,
	groupByRun,
	type LoggedEvent,
	parseEventRow,
} from "./events";

/**
 * The event log of each run, kept in memory by the daemon that writes it.
 * The daemon is the only writer of its database, and every append of the
 * engine goes through `append`, so the copy here is exactly the log on disk.
 *
 * - A run's log is read from the database once, on its first use.
 * - `append` writes the event first and keeps it only once the insert has
 *   returned: nothing is kept (or published by the caller) before it is
 *   durable. An insert that throws leaves the copy as it was.
 * - Open runs (running, waiting, sleeping) stay in memory. The logs of ended
 *   runs are dropped, least recently used first, beyond `maxIdleEvents`.
 * - `derive` keeps a value derived from a run's log (a run summary, an open
 *   Gate) until the run's next append, also after its log was dropped. The
 *   run list reads it without parsing every run's log again.
 * - `ingest` adds the events of runs another Device walks, as the exchange
 *   brings them (`exchange/`): the same bookkeeping as an append, so the
 *   copy here stays exactly the log on disk.
 * - `onLanded` tells a listener about every event that landed, appended or
 *   ingested: the exchange pushes and streams on it.
 */

/** An event another Walker wrote, as the exchange carries it. */
export type ForeignEvent = {
	spaceId: string;
	runId: string;
	stepId: string | null;
	sessionId: string | null;
	type: string;
	/** JSON, as the Walker wrote it. */
	payload: string;
	at: number;
	walkerId: string;
	walkerSeq: number;
};

/** Called with the events that just landed in this Replica. */
export type LandedListener = (events: readonly LoggedEvent[]) => void;

/** A pure function of one run's log, kept by identity. */
export type Derive<T> = (events: readonly LoggedEvent[]) => T;

export type RunLogOptions = {
	/** How many events of ended runs to keep in memory. Default 20 000. */
	maxIdleEvents?: number;
	/**
	 * The Walker that appends: the Device id every event gets. A function
	 * is called once, on the first append or read that needs it (this
	 * database's own Device, `DeviceDirectory.selfId`).
	 */
	walkerId: string | (() => Promise<string>);
};

const DEFAULT_MAX_IDLE_EVENTS = 20_000;

type Log = {
	/** In seq order. */
	events: LoggedEvent[];
	/** Not ended: the latest of `RunStarted`, `RunResumed` and `RunEnded` is not `RunEnded`. */
	open: boolean;
};

const isRunEvent = (type: EngineEventType) =>
	type === "RunStarted" || type === "RunResumed" || type === "RunEnded";

function isOpen(events: readonly LoggedEvent[]): boolean {
	const latest = events.findLast((e) => isRunEvent(e.type));
	return latest !== undefined && latest.type !== "RunEnded";
}

/** Puts `e` at its place by seq. Appends land in order, almost always at the end. */
function insertBySeq(events: LoggedEvent[], e: LoggedEvent): void {
	let at = events.length;
	while (at > 0 && (events[at - 1] as LoggedEvent).seq > e.seq) at--;
	if (events[at - 1]?.seq === e.seq) return;
	events.splice(at, 0, e);
}

export function createRunLog(db: Database, options: RunLogOptions) {
	const maxIdleEvents = options.maxIdleEvents ?? DEFAULT_MAX_IDLE_EVENTS;
	/** Loaded logs by run id, least recently used first. */
	const logs = new Map<string, Log>();
	/** Logs being read, with the appends that landed meanwhile. */
	const loading = new Map<
		string,
		{ promise: Promise<Log>; landed: LoggedEvent[] }
	>();
	/** Derived values by run id, then by function. Cleared by an append. */
	const memos = new Map<string, Map<Derive<unknown>, unknown>>();
	/** Counts the appends per run, so a read that raced one is not kept. */
	const versions = new Map<string, number>();
	const landedListeners = new Set<LandedListener>();
	function landed(events: readonly LoggedEvent[]): void {
		if (events.length === 0) return;
		for (const listener of [...landedListeners]) {
			try {
				listener(events);
			} catch {
				// A broken listener must not break the append.
			}
		}
	}
	const ownWalker = options.walkerId;
	let walker: Promise<string> | undefined =
		typeof ownWalker === "string" ? Promise.resolve(ownWalker) : undefined;
	const walkerId = (): Promise<string> => {
		walker ??=
			typeof ownWalker === "string" ? Promise.resolve(ownWalker) : ownWalker();
		return walker;
	};

	async function readRuns(runIds: readonly string[]) {
		const rows = await db
			.select()
			.from(event)
			.where(
				runIds.length === 1
					? eq(event.runId, runIds[0] as string)
					: inArray(event.runId, [...runIds]),
			)
			.orderBy(asc(event.seq));
		return rows.map(parseEventRow);
	}

	function touch(runId: string, log: Log): void {
		logs.delete(runId);
		logs.set(runId, log);
	}

	/** Drops the least recently used logs of ended runs, never `keep`. */
	function trim(keep: string): void {
		let idle = 0;
		for (const log of logs.values()) if (!log.open) idle += log.events.length;
		for (const [runId, log] of logs) {
			if (idle <= maxIdleEvents) return;
			if (log.open || runId === keep) continue;
			logs.delete(runId);
			idle -= log.events.length;
		}
	}

	function logOf(runId: string): Promise<Log> {
		const cached = logs.get(runId);
		if (cached) {
			touch(runId, cached);
			return Promise.resolve(cached);
		}
		const pending = loading.get(runId);
		if (pending) return pending.promise;
		const landed: LoggedEvent[] = [];
		const promise = readRuns([runId])
			.then((events) => {
				for (const e of landed) insertBySeq(events, e);
				const log = { events, open: isOpen(events) };
				logs.set(runId, log);
				trim(runId);
				return log;
			})
			.finally(() => loading.delete(runId));
		loading.set(runId, { promise, landed });
		return promise;
	}

	function remember<T>(runId: string, fn: Derive<T>, value: T): T {
		let memo = memos.get(runId);
		if (!memo) {
			memo = new Map();
			memos.set(runId, memo);
		}
		memo.set(fn as Derive<unknown>, value);
		return value;
	}

	/** Keeps a committed event in its run's copy, and forgets what was derived from it. */
	function keep(logged: LoggedEvent): void {
		const runId = logged.runId;
		if (!runId) return;
		versions.set(runId, (versions.get(runId) ?? 0) + 1);
		memos.delete(runId);
		const log = logs.get(runId);
		if (log) {
			insertBySeq(log.events, logged);
			if (isRunEvent(logged.type)) {
				log.open = isOpen(log.events);
				if (!log.open) trim(runId);
			}
		} else {
			loading.get(runId)?.landed.push(logged);
		}
	}

	return {
		/** One run's events in seq order: a copy, so later appends do not change it. */
		async events(runId: string): Promise<LoggedEvent[]> {
			return [...(await logOf(runId)).events];
		},

		/**
		 * `fn` of each run's log, kept until the run's next append. The logs
		 * that are not in memory are read in one query and not kept.
		 */
		async derive<T>(
			runIds: readonly string[],
			fn: Derive<T>,
		): Promise<Map<string, T>> {
			const values = new Map<string, T>();
			const missing: string[] = [];
			for (const runId of runIds) {
				const memo = memos.get(runId);
				if (memo?.has(fn as Derive<unknown>)) {
					values.set(runId, memo.get(fn as Derive<unknown>) as T);
					continue;
				}
				const log = logs.get(runId);
				if (log) values.set(runId, remember(runId, fn, fn(log.events)));
				else missing.push(runId);
			}
			if (missing.length === 0) return values;
			const before = missing.map((runId) => versions.get(runId) ?? 0);
			const byRun = groupByRun(await readRuns(missing));
			for (const [i, runId] of missing.entries()) {
				if ((versions.get(runId) ?? 0) === before[i]) {
					values.set(runId, remember(runId, fn, fn(byRun.get(runId) ?? [])));
				} else {
					// An append landed during the read: read the run through its log.
					values.set(
						runId,
						remember(runId, fn, fn((await logOf(runId)).events)),
					);
				}
			}
			return values;
		},

		/** The Device that appends: the Walker of the runs this log writes. */
		walkerId,

		/**
		 * Appends one event as the Walker's next. It is kept only after the
		 * insert returned, with the seq and time the database gave it.
		 */
		async append<T extends EngineEventType>(
			input: EventInput<T>,
		): Promise<LoggedEvent> {
			const logged = await appendEvent(db, input, await walkerId());
			keep(logged);
			landed([logged]);
			return logged;
		},

		/**
		 * Adds events of runs another Device walks, in the order given (each
		 * Walker's in its own order). An event this Replica has already (the
		 * same Walker and `walker_seq`) is skipped. Returns the ones that
		 * were new, as committed.
		 */
		async ingest(events: readonly ForeignEvent[]): Promise<LoggedEvent[]> {
			const added: LoggedEvent[] = [];
			for (const e of events) {
				const [row] = await db
					.insert(event)
					.values({
						spaceId: e.spaceId,
						runId: e.runId,
						stepId: e.stepId,
						sessionId: e.sessionId,
						type: e.type,
						payload: e.payload,
						at: new Date(e.at),
						walkerId: e.walkerId,
						walkerSeq: e.walkerSeq,
					})
					.onConflictDoNothing()
					.returning();
				if (!row) continue;
				const logged = parseEventRow(row);
				keep(logged);
				added.push(logged);
			}
			landed(added);
			return added;
		},

		/** Calls `listener` with every event that lands from now on. Returns the unsubscribe. */
		onLanded(listener: LandedListener): () => void {
			landedListeners.add(listener);
			return () => landedListeners.delete(listener);
		},

		/** The logs in memory, by run id. For tests. */
		cached(): Map<string, readonly LoggedEvent[]> {
			return new Map([...logs].map(([runId, log]) => [runId, [...log.events]]));
		},
	};
}

export type RunLog = ReturnType<typeof createRunLog>;
