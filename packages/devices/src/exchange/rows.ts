import type { Database } from "@nightshift/db";
import {
	agentSession,
	event,
	project,
	run,
	step,
	syncCursor,
} from "@nightshift/db/schema";
import {
	applyWalkerMoves,
	type LoggedEvent,
	type RunBus,
	type RunLog,
} from "@nightshift/engine";
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * The event log exchange: run history between Replicas, by cursor. Every
 * row of a run has one Owner, its Walker, so the merge is a union: a row
 * a Replica has already is skipped, and nothing is updated across Devices
 * but the run's Walker, which follows its `WalkerMoved` on every Replica.
 * A moved run's rows are each of its Walkers' to send. The cursor is
 * "this Walker's events in this Space after `walker_seq` N" (`sync_cursor`,
 * per Host).
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

export type Exchange = ReturnType<typeof createExchange>;

export function createExchange(deps: {
	db: Database;
	log: RunLog;
	bus: RunBus;
}) {
	const { db, log, bus } = deps;

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
		const limit = input.limit ?? 500;
		const events: (typeof event.$inferSelect)[] = [];
		const cursors: SyncCursors = {};
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
	): Promise<RunRows> {
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
		rows: RunRows,
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
	async function knownRuns(rows: RunRows) {
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
		rows: RunRows,
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
		rows: RunRows,
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
