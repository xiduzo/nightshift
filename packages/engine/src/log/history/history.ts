import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Database } from "@nightshift/db";
import { agentSession, event, run, step } from "@nightshift/db/schema";
import { instant } from "@nightshift/time";
import { and, asc, eq, gt, inArray, isNotNull, max, sql } from "drizzle-orm";
import { asCommand, type RunLog } from "../run-log";
import { runsArriving } from "../run-row";
import {
	type BusItem,
	commandLogPath,
	type RunBus,
	readTranscriptFile,
	type TranscriptEntry,
	transcriptToRead,
} from "../transcript";
import { createHistoryIngest } from "./history-ingest";
import {
	type HistoryCursors,
	type HistoryRows,
	NO_ROWS,
	type OwnStepFiles,
} from "./history-rows";
import { createLandedFeed, type LandedFeed } from "./landed";

/**
 * The run history of this Replica, as the exchange of `@nightshift/devices`
 * copies it between Replicas by cursor. The engine owns the rows of runs,
 * steps, agent sessions and events: the exchange reads and adds them only
 * here. The wire (its schemas, the cursors kept per Host, the transport)
 * is the exchange's.
 *
 * Every row of a run has one Owner, its Walker, so the merge is a union: a
 * row a Replica has already is skipped, and nothing is updated across
 * Devices but the run's Walker, which follows its `WalkerMoved` on every
 * Replica. A moved run's rows are each of its Walkers' to send. The cursor
 * is "this Walker's events in this Space after `walker_seq` N".
 *
 * - What moves: runs, steps, agent sessions and the events of runs. Facts
 *   of no run (a project's, a schedule's, a Device's) stay on the Replica
 *   that wrote them: the Space document carries the Space's definitions.
 * - A batch carries its events in the order they landed in the Replica
 *   that serves it (its `seq`), so each Walker's in its own order, and a
 *   moved run's events of its old Walker before those of its new one. It
 *   carries the run, step and session rows they name, so a receiver
 *   inserts parents first and foreign keys hold.
 * - A batch lands in one transaction: its rows, its events, and the
 *   columns that follow from the log (the run's Walker, a session's
 *   harness id). Each of those is read from the log, so a batch that comes
 *   again after a crash repeats them, and an older Replica that lost one
 *   gets it back.
 * - One column changes after its insert: `agent_session.harness_session_id`.
 *   It is the Walker's copy of its `HarnessSessionAssigned` event, so a
 *   receiver fills it from that event, never from another Replica's row.
 * - A run's project must be in the receiver's Replica first: it comes with
 *   the Space document. Until it has, the batch is refused as not yet
 *   (`MissingProjectError`), and comes again.
 */

export type RunHistory = ReturnType<typeof createRunHistory>;

/**
 * A run's Walker, Space and Project, or null for a run this Replica
 * lacks: what a keeper of secrets checks a step's run against.
 */
export async function runPlaceOf(
	db: Database,
	runId: string,
): Promise<{ walkerId: string; spaceId: string; projectId: string } | null> {
	const [row] = await db
		.select({
			spaceId: run.spaceId,
			projectId: run.projectId,
			walkerId: run.walkerId,
		})
		.from(run)
		.where(eq(run.id, runId));
	return row ?? null;
}

export function createRunHistory(deps: {
	db: Database;
	dataDir: string;
	log: RunLog;
	bus: RunBus;
	/** Every run event as it lands here (the engine's own). Default: a new one on `log`. */
	landed?: LandedFeed;
}) {
	const { db, dataDir, log, bus } = deps;
	const landed: LandedFeed = deps.landed ?? createLandedFeed({ db, log });

	/**
	 * The run rows of `spaces` after `cursors`, in the order their events
	 * landed here: every Walker's but `except`, or only `only`'s. At most
	 * `limit` events. Returns the cursors moved past them.
	 *
	 * This Replica's order keeps each Walker's order per Space (its events
	 * land here in that order), and it is the only order that knows a
	 * moved run's Walkers apart: the new Walker wrote nothing before the
	 * move landed. A receiver that adds the batch in this order stores the
	 * run as it happened.
	 */
	async function rowsAfter(input: {
		spaces: readonly string[];
		cursors: HistoryCursors;
		only?: string;
		except?: string;
		limit?: number;
	}): Promise<{ rows: HistoryRows; cursors: HistoryCursors }> {
		const limit = input.limit ?? 500;
		const found: (typeof event.$inferSelect)[] = [];
		const cursors: HistoryCursors = {};
		const scope = {
			...(input.only !== undefined ? { only: input.only } : {}),
			...(input.except !== undefined ? { except: input.except } : {}),
		};
		// Nothing new for these cursors: no query at all.
		if (!landed.hasAfter(input.spaces, input.cursors, scope)) {
			return { rows: NO_ROWS, cursors };
		}
		// Only the Walkers with events after their cursor are read.
		const walkers = await landed.walkersAfter(
			input.spaces,
			input.cursors,
			scope,
		);
		// Each Walker's first `limit` in a Space hold all of its events among
		// the first `limit` of them all: the merge by `seq` takes those.
		/** Each event's place in its Walker's order, in this batch. */
		const next = new Map<(typeof found)[number], number>();
		for (const { spaceId, walkerId, after } of walkers) {
			const list = await db
				.select()
				.from(event)
				.where(
					and(
						eq(event.walkerId, walkerId),
						gt(event.walkerSeq, after),
						eq(event.spaceId, spaceId),
						isNotNull(event.runId),
					),
				)
				.orderBy(asc(event.walkerSeq))
				.limit(limit);
			for (const [i, e] of list.entries()) next.set(e, i);
			found.push(...list);
		}
		// A cursor counts in the Walker's order, so each Walker's events go
		// in that order: one that landed here out of it waits for the next
		// batch, with every later one of its Walker.
		const taken = new Map<string, number>();
		const events: typeof found = [];
		for (const e of found.sort((x, y) => x.seq - y.seq)) {
			if (events.length >= limit) break;
			const key = `${e.spaceId}\n${e.walkerId}`;
			if (next.get(e) !== (taken.get(key) ?? 0)) continue;
			taken.set(key, (taken.get(key) ?? 0) + 1);
			events.push(e);
			cursors[e.spaceId] = { ...cursors[e.spaceId], [e.walkerId]: e.walkerSeq };
		}
		return { rows: await withParents(events), cursors };
	}

	/** The events as the exchange carries them, with the rows they name. */
	async function withParents(
		events: (typeof event.$inferSelect)[],
	): Promise<HistoryRows> {
		if (events.length === 0) return NO_ROWS;
		const ids = (pick: (e: (typeof events)[number]) => string | null) => [
			...new Set(events.map(pick).filter((id): id is string => id !== null)),
		];
		const runIds = ids((e) => e.runId);
		const stepIds = ids((e) => e.stepId);
		const sessionIds = ids((e) => e.sessionId);
		const [runs, steps, sessions] = await Promise.all([
			db.select().from(run).where(inArray(run.id, runIds)),
			stepIds.length
				? db.select().from(step).where(inArray(step.id, stepIds))
				: [],
			sessionIds.length
				? db
						.select()
						.from(agentSession)
						.where(inArray(agentSession.id, sessionIds))
				: [],
		]);
		return {
			runs: runs.map((r) => ({ ...r, createdAt: instant(r.createdAt) })),
			steps: steps.map((s) => ({ ...s, createdAt: instant(s.createdAt) })),
			sessions: sessions.map((s) => ({
				...s,
				createdAt: instant(s.createdAt),
			})),
			events: events.map((e) => ({
				spaceId: e.spaceId,
				runId: e.runId as string,
				stepId: e.stepId,
				sessionId: e.sessionId,
				type: e.type,
				payload: e.payload,
				at: instant(e.at),
				walkerId: e.walkerId,
				walkerSeq: e.walkerSeq,
			})),
		};
	}

	/** Adds a batch to this Replica (`history-ingest.ts`). */
	const ingest = createHistoryIngest({ db, log, bus });

	/** A run's Walker and Space, or null for a run this Replica lacks. */
	async function runOwner(
		runId: string,
	): Promise<{ walkerId: string; spaceId: string } | null> {
		const [row] = await db
			.select({ walkerId: run.walkerId, spaceId: run.spaceId })
			.from(run)
			.where(eq(run.id, runId));
		return row ?? null;
	}

	/** A run's Walker, Space and Project, or null (`runPlaceOf`). */
	const runPlace = (runId: string) => runPlaceOf(db, runId);

	/** The last event count this Replica has of a Walker: 0 for none (ADR 20). */
	async function lastWalkerSeq(walkerId: string): Promise<number> {
		const [row] = await db
			.select({ last: max(event.walkerSeq) })
			.from(event)
			.where(eq(event.walkerId, walkerId));
		return row?.last ?? 0;
	}

	/** A step's run, Walker and Space, or null. */
	async function stepOwner(
		stepId: string,
	): Promise<{ runId: string; walkerId: string; spaceId: string } | null> {
		const [row] = await db
			.select({
				runId: step.runId,
				walkerId: run.walkerId,
				spaceId: step.spaceId,
			})
			.from(step)
			.innerJoin(run, eq(run.id, step.runId))
			.where(eq(step.id, stepId));
		return row ?? null;
	}

	/**
	 * A step this Replica walked, as files: its transcript and its command
	 * log (null when it has none). Null for a step of a run walked
	 * elsewhere: one whose run's Walker is not `walkerId`.
	 */
	async function ownStepFiles(
		stepId: string,
		walkerId: string,
	): Promise<OwnStepFiles | null> {
		const [row] = await db
			.select({
				spaceId: step.spaceId,
				runId: step.runId,
				transcriptPath: step.transcriptPath,
				walkerId: run.walkerId,
			})
			.from(step)
			.innerJoin(run, eq(run.id, step.runId))
			.where(eq(step.id, stepId));
		if (!row || row.walkerId !== walkerId) return null;
		const read = async (path: string) =>
			existsSync(path) ? readFile(path, "utf8") : null;
		return {
			spaceId: row.spaceId,
			runId: row.runId,
			transcript: await read(
				transcriptToRead(dataDir, row.runId, stepId, row.transcriptPath),
			),
			log: await read(commandLogPath(dataDir, row.runId, stepId)),
		};
	}

	/** The entries of a step's own transcript file on this Replica: none when it has no file. */
	async function ownTranscript(at: {
		runId: string;
		stepId: string;
	}): Promise<TranscriptEntry[]> {
		const [row] = await db
			.select({ runId: step.runId, transcriptPath: step.transcriptPath })
			.from(step)
			.where(eq(step.id, at.stepId));
		if (!row || row.runId !== at.runId) return [];
		return readTranscriptFile(
			transcriptToRead(dataDir, at.runId, at.stepId, row.transcriptPath),
		);
	}

	/**
	 * Whether this Replica's log has an event the Command wrote: it was
	 * applied here, also before a restart (`command-stamp.ts`).
	 */
	async function applied(command: {
		id: string;
		runId: string;
	}): Promise<boolean> {
		const [row] = await db
			.select({ seq: event.seq })
			.from(event)
			.where(
				and(
					eq(event.runId, command.runId),
					sql`json_extract(${event.payload}, '$.commandId') = ${command.id}`,
				),
			)
			.limit(1);
		return row !== undefined;
	}

	/**
	 * The runs that moved to one of `here` and have not arrived
	 * (`runsArriving`). Read from the log, so a take-over that failed, or
	 * that a restart cut short, is found again.
	 */
	function arriving(here: readonly string[]): Promise<string[]> {
		return runsArriving(db, here);
	}

	/** The latest presence event of each Device (`DeviceOnline` or `DeviceOffline`), by Device id. */
	async function devicePresence(): Promise<Map<string, string>> {
		const presence = await db
			.select({
				deviceId: sql<string>`json_extract(${event.payload}, '$.deviceId')`,
				type: event.type,
			})
			.from(event)
			.where(inArray(event.type, ["DeviceOnline", "DeviceOffline"]))
			.orderBy(asc(event.seq));
		return new Map(presence.map((p) => [p.deviceId, p.type]));
	}

	return {
		rowsAfter,
		ingest,
		runOwner,
		runPlace,
		lastWalkerSeq,
		stepOwner,
		ownStepFiles,
		ownTranscript,
		devicePresence,
		applied,
		/** Runs `fn` as the Command: the first event it writes to the Command's run carries its id (`command-stamp.ts`). */
		applying: asCommand,
		arriving,
		/** A run's events as this Replica's log has them, in their order. */
		events: (runId: string) => log.events(runId),
		/** Calls `listener` with each change of the run as it happens here, until the returned function is called. */
		watch: (runId: string, listener: (item: BusItem) => void) =>
			bus.subscribe(runId, listener),
		/** Tells the run's watchers that a step's files changed: a copy of its transcript came. */
		stepChanged(runId: string, stepId: string): void {
			bus.publish(runId, { kind: "step-changed", stepId });
		},
	};
}
