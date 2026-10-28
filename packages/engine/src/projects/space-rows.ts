import type { Database } from "@nightshift/db";
import {
	agentSession,
	clone,
	event,
	keptVariable,
	project,
	run,
	step,
} from "@nightshift/db/schema";
import {
	and,
	count,
	eq,
	exists,
	gt,
	inArray,
	isNull,
	lt,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { type AnySQLiteColumn, alias } from "drizzle-orm/sqlite-core";
import { personFieldTypes } from "../log";

/**
 * The rows of Projects that move from one Space to another, as the
 * statements of one `db.batch`: every row lands in the new Space, or none
 * does. A caller adds what it owns of the same move (the Space's members,
 * the notifications) to the same batch.
 *
 * What moves with a Project: its row, its Clones, its runs with their
 * steps, Agent sessions and events, the facts of no run that name it
 * (`ProjectAdded`, a schedule's `ScheduleFired`, a webhook), and its kept
 * variables. The Space document and the flow documents are Yjs documents,
 * not rows: the caller changes those after the batch.
 *
 * - `projectMap` names each Project to move, by its id in `from`, with
 *   its id in `to`: its own, or the id of the Project of `to` with the
 *   same remote (`project_remote_idx` holds one Project per remote on a
 *   Replica). A Project that maps onto another one gives it its Clones,
 *   runs, events and kept variables, and its own row goes. A kept
 *   variable that both have keeps the latest write. The Project of `to`
 *   gets a row when this Replica has none yet.
 * - `personMap` gives a Person of `from` their id in `to`: the runs'
 *   `started_by`, and each field of a moved event that names a Person
 *   (`PERSON_FIELDS`), take it.
 * - `walkerId`: this computer. Its moved events take the numbers after
 *   its latest event that does not move, in their order. A cursor of the
 *   exchange counts a Walker's events per Space, so the events then come
 *   after every cursor of `to` and reach its Host. Without it, the numbers
 *   stay: a move between two Spaces this Replica keeps.
 */
export type SpaceMove = {
	from: string;
	to: string;
	/** Each Project to move, by its id in `from`: its id in `to`. */
	projectMap: Readonly<Record<string, string>>;
	/** A Person's id in `from`: their id in `to`. */
	personMap?: Readonly<Record<string, string>>;
	/** This computer: its moved events get new numbers after its latest. */
	walkerId?: string;
};

/** The statements of one move, in the order they must run. */
export type SpaceMoveBatch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/**
 * The statements that move the Projects' rows from `from` to `to`. Reads
 * the Projects first, and throws when one is not in `from`, or maps onto
 * a Project of another Space or of another remote.
 */
export async function spaceMoveBatch(
	db: Database,
	move: SpaceMove,
): Promise<SpaceMoveBatch> {
	const { from, to } = move;
	const persons = Object.entries(move.personMap ?? {}).filter(
		([local, there]) => local !== there,
	);
	const sources = Object.keys(move.projectMap);
	const pairs = Object.entries(move.projectMap);
	const kept = pairs.filter(([source, target]) => source === target);
	const merged = pairs.filter(([source, target]) => source !== target);
	const keptIds = kept.map(([source]) => source);

	const rows = new Map(
		(await db.select().from(project).where(inArray(project.id, sources))).map(
			(row) => [row.id, row],
		),
	);
	for (const source of sources) {
		if (rows.get(source)?.spaceId !== from) {
			throw new Error(`The project ${source} is not in the Space ${from}.`);
		}
	}
	const targets = new Map(
		(
			await db
				.select()
				.from(project)
				.where(
					inArray(
						project.id,
						merged.map(([, target]) => target),
					),
				)
		).map((row) => [row.id, row]),
	);
	for (const [source, target] of merged) {
		if (Object.hasOwn(move.projectMap, target)) {
			throw new Error(`The project ${target} both moves and takes a move.`);
		}
		const row = targets.get(target);
		if (row && row.spaceId !== to) {
			throw new Error(`The project ${target} is not in the Space ${to}.`);
		}
		const remote = rows.get(source)?.remote ?? null;
		if (row && row.remote !== null && row.remote !== remote) {
			throw new Error(
				`The project ${source} cannot take the place of ${target}: their remotes differ.`,
			);
		}
	}

	const movedRuns = db
		.select({ id: run.id })
		.from(run)
		.where(and(eq(run.spaceId, from), inArray(run.projectId, sources)));
	/** The events that move, of `e`: never null, also for a row without a run. */
	const moving = (e: {
		spaceId: AnySQLiteColumn;
		runId: AnySQLiteColumn;
		payload: AnySQLiteColumn;
	}): SQL =>
		sql`coalesce(${and(
			eq(e.spaceId, from),
			or(
				inArray(e.runId, movedRuns),
				and(
					isNull(e.runId),
					inArray(sql`json_extract(${e.payload}, '$.projectId')`, sources),
				),
			),
		)}, 0)`;
	const other = alias(event, "other_event");

	const statements: BatchItem<"sqlite">[] = [];

	// A Project of `to` this Replica lacks gets its row first, without the
	// remote its source still holds: the moved rows point at it.
	const added = new Set<string>();
	for (const [source, target] of merged) {
		const row = rows.get(source);
		if (!row || targets.has(target) || added.has(target)) continue;
		added.add(target);
		statements.push(
			db
				.insert(project)
				.values({
					id: target,
					spaceId: to,
					name: row.name,
					remote: null,
					createdAt: row.createdAt,
					removedAt: row.removedAt,
				})
				.onConflictDoNothing(),
		);
	}

	if (move.walkerId !== undefined) {
		const walker = move.walkerId;
		// First each moved event its place among them, below zero, so no
		// number meets one in use; then the numbers after the latest one
		// that stays.
		statements.push(
			db
				.update(event)
				.set({
					walkerSeq: sql`-(${db
						.select({ n: count() })
						.from(other)
						.where(
							and(
								eq(other.walkerId, walker),
								sql`${moving(other)}`,
								lte(other.seq, sql.raw(`"event"."seq"`)),
							),
						)})`,
				})
				.where(and(eq(event.walkerId, walker), moving(event))),
			db
				.update(event)
				.set({
					walkerSeq: sql`(${db
						.select({ latest: sql`coalesce(max(${other.walkerSeq}), 0)` })
						.from(other)
						.where(
							and(eq(other.walkerId, walker), sql`not ${moving(other)}`),
						)}) - ${event.walkerSeq}`,
				})
				.where(and(eq(event.walkerId, walker), lt(event.walkerSeq, 0))),
		);
	}

	if (persons.length > 0) {
		const locals = persons.map(([local]) => local);
		const cases = sql.join(
			persons.map(([local, there]) => sql`when ${local} then ${there}`),
			sql` `,
		);
		for (const [field, types] of personFieldTypes()) {
			const path = `$.${field}`;
			const value = sql`json_extract(${event.payload}, ${path})`;
			statements.push(
				db
					.update(event)
					.set({
						payload: sql`json_set(${event.payload}, ${path}, case ${value} ${cases} end)`,
					})
					.where(
						and(
							inArray(event.type, types),
							inArray(value, locals),
							moving(event),
						),
					),
			);
		}
	}

	statements.push(
		db.update(event).set({ spaceId: to }).where(moving(event)),
		...merged.map(([source, target]) =>
			db
				.update(event)
				.set({
					payload: sql`json_set(${event.payload}, '$.projectId', ${target})`,
				})
				.where(
					and(
						eq(event.spaceId, to),
						eq(sql`json_extract(${event.payload}, '$.projectId')`, source),
					),
				),
		),
		db.update(step).set({ spaceId: to }).where(inArray(step.runId, movedRuns)),
		db
			.update(agentSession)
			.set({ spaceId: to })
			.where(inArray(agentSession.runId, movedRuns)),
		db
			.update(clone)
			.set({ spaceId: to })
			.where(inArray(clone.projectId, keptIds)),
		db
			.update(keptVariable)
			.set({ spaceId: to })
			.where(inArray(keptVariable.projectId, keptIds)),
	);

	const otherClone = alias(clone, "other_clone");
	const otherKept = alias(keptVariable, "other_kept");
	/** Another kept variable of `projectId` with the same flow and name as the row being changed. */
	const sameKept = (projectId: string, newer: boolean) =>
		exists(
			db
				.select({ one: sql`1` })
				.from(otherKept)
				.where(
					and(
						eq(otherKept.projectId, projectId),
						eq(otherKept.flowName, sql.raw(`"kept_variable"."flow_name"`)),
						eq(otherKept.name, sql.raw(`"kept_variable"."name"`)),
						newer
							? gt(otherKept.updatedAt, sql.raw(`"kept_variable"."updated_at"`))
							: undefined,
					),
				),
		);
	for (const [source, target] of merged) {
		statements.push(
			// A Device keeps one Clone of a Project: the one `to` knows stays.
			db
				.delete(clone)
				.where(
					and(
						eq(clone.projectId, source),
						inArray(
							clone.deviceId,
							db
								.select({ deviceId: otherClone.deviceId })
								.from(otherClone)
								.where(eq(otherClone.projectId, target)),
						),
					),
				),
			db
				.update(clone)
				.set({ spaceId: to, projectId: target })
				.where(eq(clone.projectId, source)),
			// The latest write of a kept variable wins; on a tie, `to`'s.
			db
				.delete(keptVariable)
				.where(and(eq(keptVariable.projectId, target), sameKept(source, true))),
			db
				.delete(keptVariable)
				.where(
					and(eq(keptVariable.projectId, source), sameKept(target, false)),
				),
			db
				.update(keptVariable)
				.set({ spaceId: to, projectId: target })
				.where(eq(keptVariable.projectId, source)),
		);
	}

	if (persons.length > 0) {
		statements.push(
			db
				.update(run)
				.set({
					startedBy: sql`case ${run.startedBy} ${sql.join(
						persons.map(([local, there]) => sql`when ${local} then ${there}`),
						sql` `,
					)} end`,
				})
				.where(
					and(
						eq(run.spaceId, from),
						inArray(run.projectId, sources),
						inArray(
							run.startedBy,
							persons.map(([local]) => local),
						),
					),
				),
		);
	}
	statements.push(
		db
			.update(run)
			.set({
				spaceId: to,
				projectId:
					merged.length === 0
						? run.projectId
						: sql`case ${run.projectId} ${sql.join(
								merged.map(
									([source, target]) => sql`when ${source} then ${target}`,
								),
								sql` `,
							)} else ${run.projectId} end`,
			})
			.where(and(eq(run.spaceId, from), inArray(run.projectId, sources))),
		db.update(project).set({ spaceId: to }).where(inArray(project.id, keptIds)),
	);
	for (const [source, target] of merged) {
		const remote = rows.get(source)?.remote ?? null;
		statements.push(db.delete(project).where(eq(project.id, source)));
		if (remote !== null) {
			statements.push(
				db
					.update(project)
					.set({ remote })
					.where(and(eq(project.id, target), isNull(project.remote))),
			);
		}
	}

	const [first, ...rest] = statements;
	if (!first) throw new Error("A move has no statements.");
	return [first, ...rest];
}

/** A Project's row as a merge of Spaces reads it. */
export type MovingProject = {
	id: string;
	spaceId: string;
	name: string;
	remote: string | null;
	createdAt: number;
	removedAt: number | null;
};

const movingColumns = {
	id: project.id,
	spaceId: project.spaceId,
	name: project.name,
	remote: project.remote,
	createdAt: project.createdAt,
	removedAt: project.removedAt,
};

function moving(row: {
	id: string;
	spaceId: string;
	name: string;
	remote: string | null;
	createdAt: Date;
	removedAt: Date | null;
}): MovingProject {
	return {
		...row,
		createdAt: row.createdAt.getTime(),
		removedAt: row.removedAt?.getTime() ?? null,
	};
}

/**
 * The Projects of this Replica with one of `ids` or one of `remotes`, in
 * any Space, removed ones too: what a Host reads before it takes the
 * Projects of a Device's personal Space (one Project per remote on a
 * Replica, `project_remote_idx`).
 */
export async function projectRowsOf(
	db: Database,
	input: { ids?: readonly string[]; remotes?: readonly string[] },
): Promise<MovingProject[]> {
	const ids = [...(input.ids ?? [])];
	const remotes = [...(input.remotes ?? [])];
	if (ids.length === 0 && remotes.length === 0) return [];
	const rows = await db
		.select(movingColumns)
		.from(project)
		.where(
			or(
				ids.length > 0 ? inArray(project.id, ids) : undefined,
				remotes.length > 0 ? inArray(project.remote, remotes) : undefined,
			),
		);
	return rows.map(moving);
}
