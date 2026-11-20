import type { Database } from "@nightshift/db";
import {
	agentSession,
	answerCost,
	clone,
	event,
	keptVariable,
	nodeMemory,
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
import { personFieldTypes } from "../../../log";
import type { RowMove } from "../../domain/move";

/**
 * The rows of Projects that move from one Space to another, as the
 * statements of one `db.batch`: every row lands in the new Space, or none
 * does. A caller adds what it owns of the same move (the Space's members,
 * the notifications) to the same batch.
 *
 * What moves with a Project: its row, its Clones, its runs with their
 * steps, Agent sessions and events, the facts of no run that name it
 * (`ProjectAdded`, a schedule's `ScheduleFired`, a webhook), its kept
 * variables, what its Since last run nodes saw (`node_memory`), and what
 * the answers of Night Shift's own agents about it cost (`answer_cost`).
 * A moved answer cost goes to the Host of its new Space as a new row
 * there: it loses the number and the receipt of the Host it came from.
 * The Space document and the flow documents are Yjs documents, not rows:
 * the caller changes those after the batch.
 *
 * - `projectMap` names each Project to move, by its id in `from`, with
 *   its id in `to`: its own, or the id of the Project of `to` with the
 *   same remote (`project_remote_idx` holds one Project per remote on a
 *   Replica). A Project that maps onto another one gives it its Clones,
 *   runs, events, kept variables and memory, and its own row goes. A kept
 *   variable or a remembered key that both have keeps the latest write. The Project of `to`
 *   gets a row when this Replica has none yet.
 * - `personMap` gives a Person of `from` their id in `to`: the runs'
 *   `started_by`, and each field of a moved event that names a Person
 *   (`PERSON_FIELDS`), take it.
 * - `walkerId`: this computer. Its moved events take the numbers after
 *   its latest event that does not move, in their order. A cursor of the
 *   exchange counts a Walker's events per Space, so the events then come
 *   after every cursor of `to` and reach its Host. Without it, the numbers
 *   stay: a move between two Spaces this Replica keeps.
 * - `runsOf`: only the runs this Walker walks move, with their steps,
 *   Agent sessions and events. The others stay in `from` as they are: a
 *   Device that leaves its Home Host takes the runs it walked, and the
 *   Host keeps all. Every Project then keeps its id (`projectMap` maps
 *   each one onto itself), so the runs that stay still name it. Of the
 *   answer costs, only this computer's own answers move.
 */
/** The statements of one move, in the order they must run. */
export type SpaceMoveBatch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/**
 * The statements that move the Projects' rows from `from` to `to`. Reads
 * the Projects first, and throws when one is not in `from`, or maps onto
 * a Project of another Space or of another remote.
 */
export async function spaceMoveBatch(
	db: Database,
	move: RowMove,
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
	if (move.runsOf !== undefined && merged.length > 0) {
		throw new Error("A move of one Walker's runs keeps every Project's id.");
	}
	/** The runs of the moved Projects in `from` that move. */
	const ofMovedProjects = and(
		eq(run.spaceId, from),
		inArray(run.projectId, sources),
		move.runsOf === undefined ? undefined : eq(run.walkerId, move.runsOf),
	);

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

	const movedRuns = db.select({ id: run.id }).from(run).where(ofMovedProjects);
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
					folder: row.folder,
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
		db
			.update(nodeMemory)
			.set({ spaceId: to })
			.where(inArray(nodeMemory.projectId, keptIds)),
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
	const otherMemory = alias(nodeMemory, "other_memory");
	/** Another remembered key of `projectId` with the same flow, node, scope and key as the row being changed. */
	const sameMemory = (projectId: string, newer: boolean) =>
		exists(
			db
				.select({ one: sql`1` })
				.from(otherMemory)
				.where(
					and(
						eq(otherMemory.projectId, projectId),
						eq(otherMemory.rootFlow, sql.raw(`"node_memory"."root_flow"`)),
						eq(otherMemory.nodePath, sql.raw(`"node_memory"."node_path"`)),
						eq(otherMemory.scope, sql.raw(`"node_memory"."scope"`)),
						eq(otherMemory.itemKey, sql.raw(`"node_memory"."item_key"`)),
						newer
							? gt(otherMemory.updatedAt, sql.raw(`"node_memory"."updated_at"`))
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
			// The same for what a Since last run node saw, key by key.
			db
				.delete(nodeMemory)
				.where(and(eq(nodeMemory.projectId, target), sameMemory(source, true))),
			db
				.delete(nodeMemory)
				.where(
					and(eq(nodeMemory.projectId, source), sameMemory(target, false)),
				),
			db
				.update(nodeMemory)
				.set({ spaceId: to, projectId: target })
				.where(eq(nodeMemory.projectId, source)),
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
						ofMovedProjects,
						inArray(
							run.startedBy,
							persons.map(([local]) => local),
						),
					),
				),
		);
	}
	// What the answers about a moved Project cost. A Person of `from` takes
	// their id in `to`. The Host of `to` has none of them yet.
	statements.push(
		db
			.update(answerCost)
			.set({
				spaceId: to,
				hostSeq: null,
				sentAt: null,
				...(merged.length === 0
					? {}
					: {
							projectId: sql`case ${answerCost.projectId} ${sql.join(
								merged.map(
									([source, target]) => sql`when ${source} then ${target}`,
								),
								sql` `,
							)} else ${answerCost.projectId} end`,
						}),
				...(persons.length === 0
					? {}
					: {
							personId: sql`case ${answerCost.personId} ${sql.join(
								persons.map(
									([local, there]) => sql`when ${local} then ${there}`,
								),
								sql` `,
							)} else ${answerCost.personId} end`,
						}),
			})
			.where(
				and(
					eq(answerCost.spaceId, from),
					inArray(answerCost.projectId, sources),
					move.runsOf === undefined ? undefined : isNull(answerCost.deviceId),
				),
			),
	);
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
			.where(ofMovedProjects),
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
