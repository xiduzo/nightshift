import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import { isNotNull, max } from "drizzle-orm";

import type { LandedEvent } from "./events";
import type { RunLog } from "./run-log";

/**
 * The landed feed of this Replica: every event of a run as it lands here,
 * appended by this computer or brought by the exchange from another
 * Walker, with its Space. Beside it, per Space and Walker, the latest
 * `walker_seq` of a run event here: read once from the log, then kept
 * from each landing. One per run history, over its run log.
 *
 * - Its readers subscribe by Space and Walker: the exchange's streams,
 *   the notifier, keep this computer awake. A landing costs them no
 *   query: the Space comes with the row.
 * - `hasAfter` says, with no query, whether a Replica at some Sync
 *   cursors lacks a run event here. `walkersAfter` names the Walkers it
 *   lacks events of, so the exchange reads only those (`rowsAfter`).
 * - A project that moves takes its runs' events to its new Space
 *   (`ProjectMoved`): the latest counts are read from the log again.
 *   Until they are, and before the first read, `hasAfter` says yes.
 * - Facts of no run are left out: the exchange does not carry them.
 */
export type LandedFeed = {
	/**
	 * Calls `listener` with the run events of each landing from now on, in
	 * seq order: those of `scope`'s Spaces and Walkers, when there are
	 * some. Returns the unsubscribe.
	 */
	subscribe(listener: LandedRunListener, scope?: LandedScope): () => void;
	/**
	 * Whether this Replica has a run event of `spaces` after `cursors` (per
	 * Space, per Walker: the last `walker_seq` a Replica has), of the
	 * Walkers `walkers` allows. No query. Yes while the latest counts are
	 * not known.
	 */
	hasAfter(
		spaces: readonly string[],
		cursors: Cursors,
		walkers?: WalkerScope,
	): boolean;
	/** The Walkers of `spaces` with run events here after `cursors`, of those `walkers` allows. */
	walkersAfter(
		spaces: readonly string[],
		cursors: Cursors,
		walkers?: WalkerScope,
	): Promise<WalkerAfter[]>;
	/** Stops following the run log. */
	close(): void;
};

/** A run event that landed in this Replica, with its Space and Walker. */
export type LandedRunEvent = LandedEvent & { runId: string };

/** Called with the run events of one landing, in seq order. */
export type LandedRunListener = (events: readonly LandedRunEvent[]) => void;

/** Every Walker's but `except`, or only `only`'s. */
export type WalkerScope = { only?: string; except?: string };

/** Which run events a reader of the feed takes: of `spaces` (default: every Space), by `WalkerScope`. */
export type LandedScope = WalkerScope & { spaces?: readonly string[] };

/** A Walker with run events in a Space after a cursor: `after` is the cursor, `latest` the last one here. */
export type WalkerAfter = {
	spaceId: string;
	walkerId: string;
	after: number;
	latest: number;
};

/** Per Space, per Walker: a `walker_seq`. */
type Cursors = Readonly<Record<string, Readonly<Record<string, number>>>>;

type Counts = Map<string, Map<string, number>>;

const allows = (walkers: WalkerScope | undefined, walkerId: string) =>
	(walkers?.only === undefined || walkerId === walkers.only) &&
	walkerId !== walkers?.except;

function count(into: Counts, e: LandedRunEvent): void {
	let walkers = into.get(e.spaceId);
	if (!walkers) {
		walkers = new Map();
		into.set(e.spaceId, walkers);
	}
	if ((walkers.get(e.walkerId) ?? 0) < e.walkerSeq) {
		walkers.set(e.walkerId, e.walkerSeq);
	}
}

export function createLandedFeed(deps: {
	db: Database;
	log: Pick<RunLog, "onLanded">;
}): LandedFeed {
	const { db, log } = deps;
	/** Per Space, per Walker: the latest `walker_seq` of a run event here. */
	let latest: Counts = new Map();
	/** Counts the moves of projects: the counts are known when `readFor` is it. */
	let moves = 0;
	let readFor = -1;
	/** The read of the counts under way, and the landings meanwhile: they go on top. */
	let reading: Promise<void> | null = null;
	let meanwhile: LandedRunEvent[] = [];
	const listeners = new Set<{
		listener: LandedRunListener;
		scope: LandedScope;
		spaces: ReadonlySet<string> | null;
	}>();

	const known = () => readFor === moves;

	/** Reads the counts from the log, one read at a time. */
	function read(): Promise<void> {
		reading ??= (async () => {
			const at = moves;
			meanwhile = [];
			const rows = await db
				.select({
					spaceId: event.spaceId,
					walkerId: event.walkerId,
					latest: max(event.walkerSeq),
				})
				.from(event)
				.where(isNotNull(event.runId))
				.groupBy(event.spaceId, event.walkerId);
			const fresh: Counts = new Map();
			for (const row of rows) {
				const walkers = fresh.get(row.spaceId) ?? new Map<string, number>();
				walkers.set(row.walkerId, row.latest ?? 0);
				fresh.set(row.spaceId, walkers);
			}
			for (const e of meanwhile) count(fresh, e);
			latest = fresh;
			readFor = at;
		})().finally(() => {
			reading = null;
			meanwhile = [];
		});
		return reading;
	}

	/** Reads the counts until they are known. A failure is logged: the next reader tries again. */
	function refresh(): void {
		void (async () => {
			while (!known()) await read();
		})().catch((error: unknown) => {
			console.error(
				"[engine] could not read the latest events per Walker:",
				error,
			);
		});
	}

	const off = log.onLanded((events) => {
		const ofRuns = events.filter((e): e is LandedRunEvent => e.runId !== null);
		for (const e of ofRuns) {
			count(latest, e);
			if (reading) meanwhile.push(e);
		}
		// Its runs' events are of another Space now: count them again.
		if (events.some((e) => e.type === "ProjectMoved")) {
			moves++;
			refresh();
		}
		if (ofRuns.length === 0) return;
		for (const { listener, scope, spaces } of [...listeners]) {
			const taken = ofRuns.filter(
				(e) =>
					(spaces === null || spaces.has(e.spaceId)) &&
					allows(scope, e.walkerId),
			);
			if (taken.length === 0) continue;
			try {
				listener(taken);
			} catch (error) {
				console.error("[engine] a listener of new run events failed:", error);
			}
		}
	});
	refresh();

	/** The Walkers after `cursors`, from the counts in memory. */
	function after(
		spaces: readonly string[],
		cursors: Cursors,
		walkers: WalkerScope | undefined,
	): WalkerAfter[] {
		const found: WalkerAfter[] = [];
		for (const spaceId of new Set(spaces)) {
			for (const [walkerId, last] of latest.get(spaceId) ?? []) {
				if (!allows(walkers, walkerId)) continue;
				const at = cursors[spaceId]?.[walkerId] ?? 0;
				if (last > at) {
					found.push({ spaceId, walkerId, after: at, latest: last });
				}
			}
		}
		return found;
	}

	return {
		subscribe(listener, scope = {}) {
			const entry = {
				listener,
				scope,
				spaces: scope.spaces ? new Set(scope.spaces) : null,
			};
			listeners.add(entry);
			return () => {
				listeners.delete(entry);
			};
		},

		hasAfter(spaces, cursors, walkers) {
			return !known() || after(spaces, cursors, walkers).length > 0;
		},

		async walkersAfter(spaces, cursors, walkers) {
			while (!known()) await read();
			return after(spaces, cursors, walkers);
		},

		close() {
			off();
			listeners.clear();
		},
	};
}
