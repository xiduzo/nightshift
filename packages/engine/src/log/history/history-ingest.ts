import type { Database } from "@nightshift/db";
import { agentSession, event, project, run, step } from "@nightshift/db/schema";
import type { JsonValue } from "@nightshift/flows";
import { asDate } from "@nightshift/time";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
	type MemoryWrite,
	type StepMemory,
	saveMemoryWrites,
} from "../../memory";
import { type KeptWrite, saveKeptWrites } from "../../variables";
import type { LoggedEvent } from "../events";
import type { RunLog } from "../run-log";
import { followWalkerMoves } from "../run-row";
import type { RunBus } from "../transcript";
import {
	ForeignRowsError,
	type HistoryRows,
	MissingProjectError,
} from "./history-rows";

/**
 * How a batch of the exchange lands in this Replica (`RunHistory.ingest`):
 * who may send its rows, the one transaction that adds them, and the word
 * to the run's watchers. `createRunHistory` makes it once.
 */
export function createHistoryIngest(deps: {
	db: Database;
	log: RunLog;
	bus: RunBus;
}) {
	const { db, log, bus } = deps;

	/**
	 * Adds a batch to this Replica, in one transaction: rows it has are
	 * skipped. With `walker`, every row must be that Walker's (a Device
	 * sends only the runs it walks); with `spaces`, every row must be in
	 * one of them. A batch that breaks either is refused whole
	 * (`ForeignRowsError`). A run whose project is not here refuses it as
	 * not yet (`MissingProjectError`). The same transaction gives each run
	 * of the batch the Walker its log names, and each session its harness
	 * id, from the log. Returns the events that were new.
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
		const before = [];
		if (rows.runs.length > 0) {
			before.push(
				db
					.insert(run)
					.values(
						rows.runs.map((r) => ({ ...r, createdAt: asDate(r.createdAt) })),
					)
					.onConflictDoNothing(),
			);
		}
		if (rows.steps.length > 0) {
			before.push(
				db
					.insert(step)
					.values(
						rows.steps.map((s) => ({ ...s, createdAt: asDate(s.createdAt) })),
					)
					.onConflictDoNothing(),
			);
		}
		if (rows.sessions.length > 0) {
			before.push(
				db
					.insert(agentSession)
					.values(
						rows.sessions.map((s) => ({
							...s,
							createdAt: asDate(s.createdAt),
						})),
					)
					.onConflictDoNothing(),
			);
		}
		const runIds = [
			...new Set([
				...rows.runs.map((r) => r.id),
				...rows.events.map((e) => e.runId),
			]),
		];
		const sessionIds = [
			...new Set(
				rows.events.flatMap((e) =>
					e.type === "HarnessSessionAssigned" && e.sessionId
						? [e.sessionId]
						: [],
				),
			),
		];
		const after = [];
		// The run's Walker follows its `WalkerMoved`, on every Replica.
		if (runIds.length > 0) after.push(followWalkerMoves(db, runIds));
		// The Walker's own copy of this fact, filled here from the fact.
		if (sessionIds.length > 0) after.push(fillHarnessSessions(sessionIds));
		// The next run here starts from the kept values the Walker saved, and
		// compares with what its Since last run nodes saw.
		const writes = await stepWritesOf(rows);
		after.push(
			...saveKeptWrites(db, writes.kept),
			...saveMemoryWrites(db, writes.memory),
		);
		const added = await log.ingest(rows.events, { before, after });
		publish(added);
		return added;
	}

	/**
	 * The writes of kept variables and the memory of Since last run nodes
	 * in the batch's new `StepEnded` events, each with its run's project.
	 * An event this Replica has already is left out, so a kept value or a
	 * memory a person reset here stays reset.
	 */
	async function stepWritesOf(
		rows: HistoryRows,
	): Promise<{ kept: KeptWrite[]; memory: MemoryWrite[] }> {
		const ended = rows.events.flatMap((e) => {
			if (e.type !== "StepEnded" || e.stepId === null) return [];
			const payload = JSON.parse(e.payload) as {
				variables?: Record<string, JsonValue>;
				kept?: { flowName: string; names: string[] };
				memory?: StepMemory;
			};
			const values: Record<string, JsonValue> = {};
			if (payload.kept && payload.variables) {
				for (const name of payload.kept.names) {
					const value = payload.variables[name];
					if (value !== undefined) values[name] = value;
				}
			}
			const kept =
				payload.kept && Object.keys(values).length > 0
					? { flowName: payload.kept.flowName, values }
					: null;
			if (!kept && !payload.memory) return [];
			return [{ e, kept, memory: payload.memory ?? null }];
		});
		if (ended.length === 0) return { kept: [], memory: [] };
		const known = new Set(
			(
				await db
					.select({ walkerId: event.walkerId, walkerSeq: event.walkerSeq })
					.from(event)
					.where(
						or(
							...ended.map(({ e }) =>
								and(
									eq(event.walkerId, e.walkerId),
									eq(event.walkerSeq, e.walkerSeq),
								),
							),
						),
					)
			).map((k) => `${k.walkerId}\n${k.walkerSeq}`),
		);
		const fresh = ended.filter(
			({ e }) => !known.has(`${e.walkerId}\n${e.walkerSeq}`),
		);
		if (fresh.length === 0) return { kept: [], memory: [] };
		const runIds = [...new Set(fresh.map(({ e }) => e.runId))];
		const projectOf = new Map(rows.runs.map((r) => [r.id, r.projectId]));
		const unknown = runIds.filter((id) => !projectOf.has(id));
		if (unknown.length > 0) {
			for (const r of await db
				.select({ id: run.id, projectId: run.projectId })
				.from(run)
				.where(inArray(run.id, unknown))) {
				projectOf.set(r.id, r.projectId);
			}
		}
		const kept: KeptWrite[] = [];
		const memory: MemoryWrite[] = [];
		for (const write of fresh) {
			const { e } = write;
			const projectId = projectOf.get(e.runId);
			if (projectId === undefined) continue;
			const stepId = e.stepId as string;
			if (write.kept) {
				kept.push({
					flow: {
						spaceId: e.spaceId,
						projectId,
						flowName: write.kept.flowName,
					},
					values: write.kept.values,
					runId: e.runId,
					stepId,
					at: e.at,
				});
			}
			if (write.memory) {
				memory.push({
					spaceId: e.spaceId,
					projectId,
					memory: write.memory,
					runId: e.runId,
					stepId,
					at: e.at,
				});
			}
		}
		return { kept, memory };
	}

	/**
	 * The statement that gives each of the sessions the harness id of its
	 * first `HarnessSessionAssigned` in the log, unless it has one.
	 */
	function fillHarnessSessions(sessionIds: readonly string[]) {
		const assigned = sql<string>`(select json_extract(${event.payload}, '$.harnessSessionId') from ${event} where ${event.sessionId} = ${agentSession.id} and ${event.type} = 'HarnessSessionAssigned' order by ${event.seq} limit 1)`;
		return db
			.update(agentSession)
			.set({ harnessSessionId: assigned })
			.where(
				and(
					inArray(agentSession.id, [...sessionIds]),
					isNull(agentSession.harnessSessionId),
					sql`${assigned} is not null`,
				),
			);
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

	return ingest;
}
