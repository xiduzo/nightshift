import type { Database } from "@nightshift/db";
import { syncCursor } from "@nightshift/db/schema";
import type { LoggedEvent, RunHistory, RunLog } from "@nightshift/engine";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

export { ForeignRowsError, MissingProjectError } from "@nightshift/engine";

/**
 * The event log exchange: run history between Replicas, by cursor. The
 * engine reads and adds the rows (`RunHistory`: what moves, the merge, the
 * checks of a batch). The exchange owns the wire: the schemas of a batch
 * and of the cursors, and this Replica's cursor with each Host
 * (`sync_cursor`): "this Walker's events in this Space after `walker_seq`
 * N". The wire types are the engine's row types (`HistoryRows`,
 * `HistoryCursors`) as zod checks them: `createExchange` assigns each to
 * the other, so a change to one fails the build until the other follows.
 */

const runRowSchema = z.object({
	id: z.string().min(1),
	spaceId: z.string().min(1),
	projectId: z.string().min(1),
	flowName: z.string().nullable(),
	flow: z.string(),
	bodyFlows: z.string(),
	title: z.string(),
	worktreePath: z.string(),
	branch: z.string(),
	baseRef: z.string(),
	walkerId: z.string().min(1),
	/**
	 * The Person who started it, as the Host knows them (null: a schedule,
	 * or before Members). A Device of a version before it sends none.
	 */
	startedBy: z.string().nullable().default(null),
	/** The Device its steps run on (null: the Walker). A Device of a version before it sends none. */
	deviceId: z.string().nullable().default(null),
	/** The Devices its nodes name, by name (JSON). A Device of a version before it sends none. */
	placements: z.string().nullable().default(null),
	createdAt: z.number(),
});

const stepRowSchema = z.object({
	id: z.string().min(1),
	spaceId: z.string().min(1),
	runId: z.string().min(1),
	nodeId: z.string(),
	nodeType: z.string(),
	visit: z.number().int(),
	transcriptPath: z.string(),
	deviceId: z.string().nullable(),
	createdAt: z.number(),
});

const sessionRowSchema = z.object({
	id: z.string().min(1),
	spaceId: z.string().min(1),
	runId: z.string().min(1),
	stepId: z.string().min(1),
	harnessSessionId: z.string().nullable(),
	prompt: z.string(),
	createdAt: z.number(),
});

const eventRowSchema = z.object({
	spaceId: z.string().min(1),
	runId: z.string().min(1),
	stepId: z.string().nullable(),
	sessionId: z.string().nullable(),
	type: z.string().min(1),
	payload: z.string(),
	at: z.number(),
	walkerId: z.string().min(1),
	walkerSeq: z.number().int().positive(),
});

/** Rows of runs, as one batch of the exchange carries them. */
export const runRowsSchema = z.object({
	runs: z.array(runRowSchema),
	steps: z.array(stepRowSchema),
	sessions: z.array(sessionRowSchema),
	events: z.array(eventRowSchema),
});
export type RunRows = z.infer<typeof runRowsSchema>;

/** Per Space, per Walker: the last `walker_seq` a Replica has. */
export const syncCursorsSchema = z.record(
	z.string(),
	z.record(z.string(), z.number().int().nonnegative()),
);
export type SyncCursors = z.infer<typeof syncCursorsSchema>;

/** A batch with no rows. */
export const NO_ROWS: RunRows = {
	runs: [],
	steps: [],
	sessions: [],
	events: [],
};

export type Exchange = ReturnType<typeof createExchange>;

export function createExchange(deps: {
	db: Database;
	log: RunLog;
	history: Pick<RunHistory, "rowsAfter" | "ingest">;
}) {
	const { db, log, history } = deps;

	/**
	 * The run rows of `spaces` after `cursors`, oldest first per Walker:
	 * every Walker's but `except`, or only `only`'s. At most `limit`
	 * events per Space and Walker. Returns the cursors moved past them.
	 */
	async function rowsAfter(input: {
		spaces: readonly string[];
		cursors: SyncCursors;
		only?: string;
		except?: string;
		limit?: number;
	}): Promise<{ rows: RunRows; cursors: SyncCursors }> {
		return history.rowsAfter(input);
	}

	/**
	 * Adds a batch to this Replica: rows it has are skipped. With `walker`,
	 * every row must be that Walker's; with `spaces`, every row must be in
	 * one of them (`RunHistory.ingest`). Returns the events that were new.
	 */
	async function ingest(
		rows: RunRows,
		check: { walker?: string; spaces?: readonly string[] } = {},
	): Promise<LoggedEvent[]> {
		return history.ingest(rows, check);
	}

	/** This Replica's cursors with a Host. */
	async function cursorsWith(hostId: string): Promise<SyncCursors> {
		const rows = await db
			.select()
			.from(syncCursor)
			.where(eq(syncCursor.hostId, hostId));
		const cursors: SyncCursors = {};
		for (const row of rows) {
			cursors[row.spaceId] = {
				...cursors[row.spaceId],
				[row.walkerId]: row.walkerSeq,
			};
		}
		return cursors;
	}

	/** Moves this Replica's cursors with a Host forward (never back). */
	async function advance(hostId: string, cursors: SyncCursors): Promise<void> {
		for (const [spaceId, walkers] of Object.entries(cursors)) {
			for (const [walkerId, walkerSeq] of Object.entries(walkers)) {
				await db
					.insert(syncCursor)
					.values({ hostId, spaceId, walkerId, walkerSeq })
					.onConflictDoUpdate({
						target: [
							syncCursor.hostId,
							syncCursor.spaceId,
							syncCursor.walkerId,
						],
						set: {
							walkerSeq: sql`max(${syncCursor.walkerSeq}, excluded.walker_seq)`,
							updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
						},
					});
			}
		}
	}

	/**
	 * Resolves when an event lands in this Replica (appended or ingested),
	 * after `timeoutMs`, or when `signal` aborts: whichever comes first.
	 */
	function landed(signal: AbortSignal, timeoutMs: number): Promise<void> {
		return new Promise((resolve) => {
			if (signal.aborted) return resolve();
			const done = () => {
				clearTimeout(timer);
				off();
				signal.removeEventListener("abort", done);
				resolve();
			};
			const timer = setTimeout(done, timeoutMs);
			const off = log.onLanded(done);
			signal.addEventListener("abort", done, { once: true });
		});
	}

	return { rowsAfter, ingest, cursorsWith, advance, landed };
}

/**
 * The rows without the Walker's own paths: where its worktree, transcripts
 * and command logs are on its disk. They are private to the Walker's
 * owner, so a Replica of another Person never gets them. Rows keep their
 * shape: a path becomes "" (`run.worktree_path`, `step.transcript_path`,
 * `WorktreeCreated.worktreePath`, `HandedOff.worktreePath`,
 * `StepStarted.transcriptPath`), and a
 * `StepStarted.logPath` that was set becomes "" too, so it still says the
 * step has a log. `keep` says per Walker whose paths stay.
 */
export function withoutPrivatePaths(
	rows: RunRows,
	keep: (walkerId: string) => boolean = () => false,
): RunRows {
	const walkerOf = new Map(rows.runs.map((r) => [r.id, r.walkerId]));
	const strip = (walkerId: string | undefined) =>
		walkerId === undefined || !keep(walkerId);
	return {
		runs: rows.runs.map((r) =>
			strip(r.walkerId) ? { ...r, worktreePath: "" } : r,
		),
		steps: rows.steps.map((s) =>
			strip(walkerOf.get(s.runId)) ? { ...s, transcriptPath: "" } : s,
		),
		sessions: rows.sessions,
		events: rows.events.map((e) => {
			if (!strip(e.walkerId)) return e;
			if (
				e.type !== "WorktreeCreated" &&
				e.type !== "StepStarted" &&
				e.type !== "HandedOff"
			) {
				return e;
			}
			const payload = JSON.parse(e.payload) as Record<string, unknown>;
			if (e.type === "WorktreeCreated" || e.type === "HandedOff") {
				payload.worktreePath = "";
			} else {
				payload.transcriptPath = "";
				if (typeof payload.logPath === "string") payload.logPath = "";
			}
			return { ...e, payload: JSON.stringify(payload) };
		}),
	};
}

/** Moves `into` forward by `by`, per Space and Walker. */
export function mergeCursors(into: SyncCursors, by: SyncCursors): SyncCursors {
	const merged: SyncCursors = { ...into };
	for (const [spaceId, walkers] of Object.entries(by)) {
		const current = { ...merged[spaceId] };
		for (const [walkerId, seq] of Object.entries(walkers)) {
			current[walkerId] = Math.max(current[walkerId] ?? 0, seq);
		}
		merged[spaceId] = current;
	}
	return merged;
}

/** Whether a batch has no rows. */
export function isEmpty(rows: RunRows): boolean {
	return rows.events.length === 0;
}
