import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { stampedAppend } from "./command-stamp";
import {
	appendEvent,
	type EngineEventType,
	type EventInput,
	type EventWrites,
	groupByRun,
	type LoggedEvent,
	parseEventRow,
} from "./events";

/**
 * The event log of each run, kept in memory by the daemon that writes it.
 * The daemon is the only writer of its database, and every append of the
 * engine goes through `append`, so the copy here is exactly the log on disk.
 *
 * - A run's log is read from the database once, on its first use. Reads
 *   at once share one query per run: a log being read is never read twice.
 * - `append` writes the event first, in one batch with the rows it names,
 *   and keeps it only once the batch committed: nothing is kept (or
 *   published by the caller) before it is durable. A write that throws
 *   leaves the copy as it was.
 * - Open runs (running, waiting, sleeping) stay in memory. The logs of ended
 *   runs are dropped, least recently used first, beyond `maxIdleEvents`.
 * - `derive` keeps a value derived from a run's log (a run summary, an open
 *   Gate, its steps) until the run's next append, also after its log was
 *   dropped. Every reader of a run's derived state goes through it, so the
 *   run list, each watcher of a run and the copy stamps share one
 *   derivation per append instead of parsing the log again each.
 * - `ingest` adds the events of runs another Device walks, as the exchange
 *   brings them (`exchange/`), in one transaction with the rows they name
 *   and what follows from them: the same bookkeeping as an append, once
 *   the transaction committed, so the copy here stays exactly the log on
 *   disk.
 * - An append made while a Command is applied (`asCommand`) carries the
 *   Command's id when it is the Command's first event of its run.
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
	/**
	 * Logs being read, with the appends that landed meanwhile. `keep`: a
	 * reader asked for the log itself (`logOf`), so it stays in memory also
	 * when the run has ended.
	 */
	const loading = new Map<
		string,
		{ promise: Promise<Log>; landed: LoggedEvent[]; keep: boolean }
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

	/**
	 * Reads the logs of `runIds` that are neither in memory nor being read,
	 * in one query. A log is kept once read only when a reader asked for it
	 * (`keep`, `logOf`). The bookkeeping happens as the rows return, before
	 * any reader goes on, so no append is lost between.
	 */
	function load(runIds: readonly string[]): void {
		const fresh = runIds.filter((id) => !logs.has(id) && !loading.has(id));
		if (fresh.length === 0) return;
		const read = readRuns(fresh).then(groupByRun);
		for (const runId of fresh) {
			const entry = {
				landed: [] as LoggedEvent[],
				keep: false,
				promise: undefined as unknown as Promise<Log>,
			};
			entry.promise = read.then(
				(byRun) => {
					loading.delete(runId);
					const events = byRun.get(runId) ?? [];
					for (const e of entry.landed) insertBySeq(events, e);
					const log = { events, open: isOpen(events) };
					if (entry.keep) {
						logs.set(runId, log);
						trim(runId);
					}
					return log;
				},
				(error: unknown) => {
					loading.delete(runId);
					throw error;
				},
			);
			// A reader that gave up early must not leave the failure unhandled.
			entry.promise.catch(() => {});
			loading.set(runId, entry);
		}
	}

	function logOf(runId: string): Promise<Log> {
		const cached = logs.get(runId);
		if (cached) {
			touch(runId, cached);
			return Promise.resolve(cached);
		}
		load([runId]);
		const entry = loading.get(runId) as NonNullable<
			ReturnType<typeof loading.get>
		>;
		entry.keep = true;
		return entry.promise;
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
		 * that are not in memory are read in one query; a log another read
		 * already asked for is not read again. A log only `derive` read is not
		 * kept. Calls at once compute `fn` once per run.
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
			load(missing);
			const reads = missing.map((runId) => ({
				runId,
				before: versions.get(runId) ?? 0,
				read: loading.get(runId)?.promise ?? logOf(runId),
			}));
			for (const { runId, before, read } of reads) {
				const loaded = await read;
				// Another call computed it meanwhile, and no append came since.
				const memo = memos.get(runId);
				if (memo?.has(fn as Derive<unknown>)) {
					values.set(runId, memo.get(fn as Derive<unknown>) as T);
					continue;
				}
				// A kept log is up to date. A log not kept that an append
				// passed is read again, through its log.
				const log =
					logs.get(runId) ??
					((versions.get(runId) ?? 0) === before ? loaded : await logOf(runId));
				values.set(runId, remember(runId, fn, fn(log.events)));
			}
			return values;
		},

		/** The Device that appends: the Walker of the runs this log writes. */
		walkerId,

		/**
		 * Appends one event as the Walker's next, in one batch with `writes`
		 * (the row the event names, say). It is kept only after the batch
		 * committed, with the seq and time the database gave it.
		 */
		async append<T extends EngineEventType>(
			input: EventInput<T>,
			writes?: EventWrites,
		): Promise<LoggedEvent> {
			const walker = await walkerId();
			const logged = await stampedAppend(
				input.runId,
				input.payload,
				(payload) => appendEvent(db, { ...input, payload }, walker, writes),
			);
			keep(logged);
			landed([logged]);
			return logged;
		},

		/**
		 * Adds events of runs another Device walks, in the order given (each
		 * Walker's in its own order), in one transaction with `writes`. An
		 * event this Replica has already (the same Walker and `walker_seq`)
		 * is skipped. Returns the ones that were new, as committed. Nothing
		 * is kept or told before the transaction committed.
		 *
		 * One `batch`, not an interactive transaction: its statements run at
		 * once on one connection, so the walk's own appends beside it never
		 * meet a write lock held across an await.
		 */
		async ingest(
			events: readonly ForeignEvent[],
			writes: EventWrites = {},
		): Promise<LoggedEvent[]> {
			const inserts = events.map((e) =>
				db
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
					.returning(),
			);
			const before = writes.before ?? [];
			const statements = [...before, ...inserts, ...(writes.after ?? [])];
			if (statements.length === 0) return [];
			const results = await db.batch(
				statements as unknown as [
					BatchItem<"sqlite">,
					...BatchItem<"sqlite">[],
				],
			);
			const added: LoggedEvent[] = [];
			for (const [i] of inserts.entries()) {
				const [row] = results[
					before.length + i
				] as (typeof event.$inferSelect)[];
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
