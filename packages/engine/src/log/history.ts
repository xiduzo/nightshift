import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Database } from "@nightshift/db";
import { agentSession, event, project, run, step } from "@nightshift/db/schema";
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { RunBus } from "./bus";
import type { LoggedEvent } from "./events";
import type { ForeignEvent, RunLog } from "./run-log";
import { applyWalkerMoves } from "./run-row";
import type { TranscriptEntry } from "./step-events";
import {
	commandLogPath,
	readTranscriptFile,
	transcriptToRead,
} from "./transcripts";

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
 * - A batch carries its events in each Walker's order, with the run, step
 *   and session rows they name, so a receiver inserts parents first and
 *   foreign keys hold.
 * - One column changes after its insert: `agent_session.harness_session_id`.
 *   It is the Walker's copy of its `HarnessSessionAssigned` event, so a
 *   receiver fills it from that event, never from another Replica's row.
 * - A run's project must be in the receiver's Replica first: it comes with
 *   the Space document. Until it has, the batch is refused as not yet
 *   (`MissingProjectError`), and comes again.
 */

/** A run's row, as a batch of the exchange carries it. */
export type HistoryRun = Omit<typeof run.$inferSelect, "createdAt"> & {
	createdAt: number;
};
/** A step's row, as a batch of the exchange carries it. */
export type HistoryStep = Omit<typeof step.$inferSelect, "createdAt"> & {
	createdAt: number;
};
/** An agent session's row, as a batch of the exchange carries it. */
export type HistorySession = Omit<
	typeof agentSession.$inferSelect,
	"createdAt"
> & { createdAt: number };

/** Rows of runs, as one batch of the exchange carries them. */
export type HistoryRows = {
	runs: HistoryRun[];
	steps: HistoryStep[];
	sessions: HistorySession[];
	events: ForeignEvent[];
};

/** Per Space, per Walker: the last `walker_seq` a Replica has. */
export type HistoryCursors = Record<string, Record<string, number>>;

/** A batch with no rows. */
const NO_ROWS: HistoryRows = {
	runs: [],
	steps: [],
	sessions: [],
	events: [],
};

/** The receiver lacks a run's project: its Space document has not reached it yet. */
export class MissingProjectError extends Error {
	constructor(readonly projectIds: string[]) {
		super(
			"This Device does not have the project of these runs yet. They come again once it has.",
		);
	}
}

/** A batch with a row its sender may not send: a run another Device walks, or a Space it is not in. */
export class ForeignRowsError extends Error {}

/** A step this Replica walked, as files: its transcript and its command log (null when it has none). */
export type OwnStepFiles = {
	spaceId: string;
	runId: string;
	transcript: string | null;
	log: string | null;
};

export type RunHistory = ReturnType<typeof createRunHistory>;

export function createRunHistory(deps: {
	db: Database;
	dataDir: string;
	log: RunLog;
	bus: RunBus;
}) {
	const { db, dataDir, log, bus } = deps;

	/**
	 * The run rows of `spaces` after `cursors`, oldest first per Walker:
	 * every Walker's but `except`, or only `only`'s. At most `limit`
	 * events per Space and Walker. Returns the cursors moved past them.
	 */
	async function rowsAfter(input: {
		spaces: readonly string[];
		cursors: HistoryCursors;
		only?: string;
		except?: string;
		limit?: number;
	}): Promise<{ rows: HistoryRows; cursors: HistoryCursors }> {
		const limit = input.limit ?? 500;
		const events: (typeof event.$inferSelect)[] = [];
		const cursors: HistoryCursors = {};
		if (input.spaces.length === 0) return { rows: NO_ROWS, cursors };
		const walkers = await db
			.selectDistinct({ spaceId: event.spaceId, walkerId: event.walkerId })
			.from(event)
			.where(
				and(
					inArray(event.spaceId, [...input.spaces]),
					isNotNull(event.runId),
					input.only ? eq(event.walkerId, input.only) : undefined,
					input.except ? sql`${event.walkerId} <> ${input.except}` : undefined,
				),
			);
		for (const { spaceId, walkerId } of walkers) {
			const after = input.cursors[spaceId]?.[walkerId] ?? 0;
			const rows = await db
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
			const last = rows.at(-1);
			if (!last) continue;
			events.push(...rows);
			cursors[spaceId] = {
				...cursors[spaceId],
				[walkerId]: last.walkerSeq,
			};
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
			runs: runs.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })),
			steps: steps.map((s) => ({ ...s, createdAt: s.createdAt.getTime() })),
			sessions: sessions.map((s) => ({
				...s,
				createdAt: s.createdAt.getTime(),
			})),
			events: events.map((e) => ({
				spaceId: e.spaceId,
				runId: e.runId as string,
				stepId: e.stepId,
				sessionId: e.sessionId,
				type: e.type,
				payload: e.payload,
				at: e.at.getTime(),
				walkerId: e.walkerId,
				walkerSeq: e.walkerSeq,
			})),
		};
	}

	/**
	 * Adds a batch to this Replica: rows it has are skipped. With `walker`,
	 * every row must be that Walker's (a Device sends only the runs it
	 * walks); with `spaces`, every row must be in one of them. A batch that
	 * breaks either is refused whole (`ForeignRowsError`). A run whose
	 * project is not here refuses it as not yet (`MissingProjectError`).
	 * Returns the events that were new.
	 */
	async function ingest(
		rows: HistoryRows,
		check: { walker?: string; spaces?: readonly string[] } = {},
	): Promise<LoggedEvent[]> {
		const known = await knownRuns(rows);
		refuseForeign(rows, known, check, await movedWalkers(rows));
		const projectIds = [...new Set(rows.runs.map((r) => r.projectId))];
		if (projectIds.length > 0) {
			const found = new Set(
				(
					await db
						.select({ id: project.id })
						.from(project)
						.where(inArray(project.id, projectIds))
				).map((p) => p.id),
			);
			const missing = projectIds.filter((id) => !found.has(id));
			if (missing.length > 0) throw new MissingProjectError(missing);
		}
		if (rows.runs.length > 0) {
			await db
				.insert(run)
				.values(
					rows.runs.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })),
				)
				.onConflictDoNothing();
		}
		if (rows.steps.length > 0) {
			await db
				.insert(step)
				.values(
					rows.steps.map((s) => ({ ...s, createdAt: new Date(s.createdAt) })),
				)
				.onConflictDoNothing();
		}
		if (rows.sessions.length > 0) {
			await db
				.insert(agentSession)
				.values(
					rows.sessions.map((s) => ({
						...s,
						createdAt: new Date(s.createdAt),
					})),
				)
				.onConflictDoNothing();
		}
		const added = await log.ingest(rows.events);
		// The run's Walker follows its `WalkerMoved`, on every Replica.
		await applyWalkerMoves(db, added);
		for (const e of added) {
			// The Walker's own copy of this fact, filled here from the fact.
			if (e.type === "HarnessSessionAssigned" && e.sessionId) {
				await db
					.update(agentSession)
					.set({ harnessSessionId: e.payload.harnessSessionId })
					.where(
						and(
							eq(agentSession.id, e.sessionId),
							isNull(agentSession.harnessSessionId),
						),
					);
			}
		}
		publish(added);
		return added;
	}

	/** The Walker and Space of each run a batch names, from the batch or this Replica. */
	async function knownRuns(rows: HistoryRows) {
		const runs = new Map(
			rows.runs.map((r) => [
				r.id,
				{ walkerId: r.walkerId, spaceId: r.spaceId },
			]),
		);
		const named = new Set([
			...rows.steps.map((s) => s.runId),
			...rows.sessions.map((s) => s.runId),
			...rows.events.map((e) => e.runId),
		]);
		const missing = [...named].filter((id) => !runs.has(id));
		if (missing.length > 0) {
			for (const r of await db
				.select({ id: run.id, walkerId: run.walkerId, spaceId: run.spaceId })
				.from(run)
				.where(inArray(run.id, missing))) {
				runs.set(r.id, { walkerId: r.walkerId, spaceId: r.spaceId });
			}
		}
		return runs;
	}

	/**
	 * The Devices that walked each run a batch names before its latest
	 * Walker: a moved run's earlier events, and its rows from the Device it
	 * moved from, are that Device's to send.
	 */
	async function movedWalkers(
		rows: HistoryRows,
	): Promise<Map<string, Set<string>>> {
		const moved = new Map<string, Set<string>>();
		const add = (runId: string, walkerId: string) => {
			const set = moved.get(runId) ?? new Set();
			set.add(walkerId);
			moved.set(runId, set);
		};
		const ids = [...new Set(rows.events.map((e) => e.runId))];
		const logged =
			ids.length === 0
				? []
				: await db
						.select({ runId: event.runId, payload: event.payload })
						.from(event)
						.where(
							and(inArray(event.runId, ids), eq(event.type, "WalkerMoved")),
						);
		const all = [
			...logged.map((e) => ({ runId: e.runId, payload: e.payload })),
			...rows.events.filter((e) => e.type === "WalkerMoved"),
		];
		for (const e of all) {
			if (!e.runId) continue;
			const payload = JSON.parse(e.payload) as { from?: string; to?: string };
			if (payload.from) add(e.runId, payload.from);
			if (payload.to) add(e.runId, payload.to);
		}
		return moved;
	}

	function refuseForeign(
		rows: HistoryRows,
		runs: Map<string, { walkerId: string; spaceId: string }>,
		check: { walker?: string; spaces?: readonly string[] },
		moved: Map<string, Set<string>> = new Map(),
	): void {
		const spaces = check.spaces ? new Set(check.spaces) : null;
		const allowed = (walkerId: string | undefined, spaceId: string) =>
			(check.walker === undefined || walkerId === check.walker) &&
			(spaces === null || spaces.has(spaceId));
		/** The run's Walkers: its latest, and those it moved from or to. */
		const walkersOf = (runId: string) =>
			new Set([
				...(runs.get(runId) ? [runs.get(runId)?.walkerId as string] : []),
				...(moved.get(runId) ?? []),
			]);
		const ofRun = (runId: string, spaceId: string) => {
			const owner = runs.get(runId);
			return (
				owner !== undefined &&
				owner.spaceId === spaceId &&
				(check.walker === undefined || walkersOf(runId).has(check.walker)) &&
				allowed(check.walker, spaceId)
			);
		};
		const ok =
			rows.runs.every(
				(r) =>
					allowed(check.walker, r.spaceId) &&
					(check.walker === undefined || walkersOf(r.id).has(check.walker)),
			) &&
			rows.steps.every((s) => ofRun(s.runId, s.spaceId)) &&
			rows.sessions.every((s) => ofRun(s.runId, s.spaceId)) &&
			rows.events.every(
				(e) =>
					allowed(e.walkerId, e.spaceId) &&
					ofRun(e.runId, e.spaceId) &&
					walkersOf(e.runId).has(e.walkerId),
			);
		if (!ok) {
			throw new ForeignRowsError(
				"A device may only send the runs it walks, in Spaces its owner is in.",
			);
		}
	}

	/** Tells the run's watchers that its log moved. */
	function publish(added: readonly LoggedEvent[]): void {
		const runs = new Map<string, Set<string>>();
		for (const e of added) {
			if (!e.runId) continue;
			const steps = runs.get(e.runId) ?? new Set<string>();
			if (e.stepId) steps.add(e.stepId);
			runs.set(e.runId, steps);
		}
		for (const [runId, steps] of runs) {
			for (const stepId of steps) {
				bus.publish(runId, { kind: "step-changed", stepId });
			}
			bus.publish(runId, { kind: "status-changed" });
		}
	}

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
		stepOwner,
		ownStepFiles,
		ownTranscript,
		devicePresence,
	};
}
