import type { Database } from "@nightshift/db";
import { nodeMemory, run } from "@nightshift/db/schema";
import { type JsonValue, MAX_MEMORY_KEYS } from "@nightshift/flows";
import { asDate, instant } from "@nightshift/time";
import { and, desc, eq, lt, max, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

/**
 * The memory of Since last run nodes: what each node saw, so the next run
 * compares with it. One row per key, by project, the run's top flow, the
 * node's path and the rendered scope (`node_memory`). A list remembers a
 * hash of each item's compared fields, a value remembers the value itself
 * (key "").
 *
 * The step reads it when it runs (`readMemory`) and saves only what it saw
 * new or changed in the batch of its `StepEnded` (`saveMemoryOfStep`), as
 * kept variables are saved: a step never ends without its memory, or the
 * reverse. The latest write wins per key. Another Replica saves it from
 * the `StepEnded` the exchange brings (`saveMemoryWrites`). A node keeps at
 * most `MAX_MEMORY_KEYS`: the oldest go first. A person lists it on the
 * flow's page and forgets it there (`listMemory`, `forgetMemory`): the
 * next run is a first run again.
 */

/** Which node's memory: a project, the run's top flow, the node's path and the scope. */
export type MemoryAt = {
	spaceId: string;
	projectId: string;
	/** The flow file the run started from. */
	rootFlow: string;
	/** The Subflow nodes from the top flow, then the node, joined with "/". */
	nodePath: string;
	/** The rendered scope, "" without one. */
	scope: string;
};

/** What a node remembers of one key: an item's hash, or a value. */
export type Remembered = { hash: string | null; value: JsonValue | null };

/**
 * What one step of a Since last run node saw new or changed, on its
 * `StepEnded`: the keys of a list with their new hashes, or the value it
 * saw. The project comes from the run.
 */
export type StepMemory = {
	rootFlow: string;
	nodePath: string;
	scope: string;
	/** A list: each key it saw new or changed, with the hash of its compared fields. */
	items?: Record<string, string>;
	/** A value: the value it saw (null is a value too). */
	value?: JsonValue;
};

/** The memory of one node and scope, as a person sees it on the flow's page. */
export type NodeMemory = {
	/** The node's path: the Subflow nodes from the top flow, then the node, joined with "/". */
	node: string;
	scope: string;
	/** How many keys it remembers. */
	keys: number;
	/** A value: the value it saw last. Absent for a list. */
	value?: JsonValue;
	/** The run whose step saved it last. */
	runId: string;
	/** When it was saved last, in ms since the epoch. */
	updatedAt: number;
};

/** Which flow's memory a person reads: a project and a flow file's name. */
export type MemoryFlow = {
	spaceId: string;
	projectId: string;
	flowName: string;
};

function parse(value: string | null): JsonValue | null {
	if (value === null) return null;
	try {
		return JSON.parse(value) as JsonValue;
	} catch {
		return null;
	}
}

/** Everything a node remembers for one scope, by key. Empty: it remembers nothing (a first run). */
export async function readMemory(
	db: Database,
	at: MemoryAt,
): Promise<Map<string, Remembered>> {
	const rows = await db
		.select({
			itemKey: nodeMemory.itemKey,
			hash: nodeMemory.hash,
			value: nodeMemory.value,
		})
		.from(nodeMemory)
		.where(
			and(
				eq(nodeMemory.spaceId, at.spaceId),
				eq(nodeMemory.projectId, at.projectId),
				eq(nodeMemory.rootFlow, at.rootFlow),
				eq(nodeMemory.nodePath, at.nodePath),
				eq(nodeMemory.scope, at.scope),
			),
		);
	return new Map(
		rows.map((row) => [
			row.itemKey,
			{ hash: row.hash, value: parse(row.value) },
		]),
	);
}

/** The rows of a step's memory: one per key, a value under the key "". */
function rowsOf(
	memory: StepMemory,
): { itemKey: string; hash: string | null; value: string | null }[] {
	if (memory.value !== undefined) {
		return [{ itemKey: "", hash: null, value: JSON.stringify(memory.value) }];
	}
	return Object.entries(memory.items ?? {}).map(([itemKey, hash]) => ({
		itemKey,
		hash,
		value: null,
	}));
}

const memoryKey = [
	nodeMemory.projectId,
	nodeMemory.rootFlow,
	nodeMemory.nodePath,
	nodeMemory.scope,
	nodeMemory.itemKey,
];

/**
 * The statement that drops the oldest keys of a node past
 * `MAX_MEMORY_KEYS`, over every scope. `projectId` may be a statement.
 */
function capOf(
	db: Database,
	projectId: string | SQL<string>,
	memory: Pick<StepMemory, "rootFlow" | "nodePath">,
): BatchItem<"sqlite"> {
	const ofNode = sql`${nodeMemory.projectId} = ${projectId} and ${nodeMemory.rootFlow} = ${memory.rootFlow} and ${nodeMemory.nodePath} = ${memory.nodePath}`;
	return db
		.delete(nodeMemory)
		.where(
			sql`rowid in (select rowid from ${nodeMemory} where ${ofNode} order by ${nodeMemory.updatedAt} desc, rowid desc limit -1 offset ${MAX_MEMORY_KEYS})`,
		);
}

/**
 * The statements that save the memory of a step this Walker ended, as its
 * `StepEnded` names it (`memory`), in the batch of that event
 * (`log/event-rows.ts`). The Space and Project are the run's, read in the
 * same statement. The latest write wins, as between two steps.
 */
export function saveMemoryOfStep(
	db: Database,
	step: { runId: string; stepId: string; memory: StepMemory },
): BatchItem<"sqlite">[] {
	const { runId, stepId, memory } = step;
	const rows = rowsOf(memory);
	if (rows.length === 0) return [];
	const spaceId = sql<string>`(select ${run.spaceId} from ${run} where ${run.id} = ${runId})`;
	const projectId = sql<string>`(select ${run.projectId} from ${run} where ${run.id} = ${runId})`;
	const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
	return [
		...rows.map((row) =>
			db
				.insert(nodeMemory)
				.values({
					spaceId,
					projectId,
					rootFlow: memory.rootFlow,
					nodePath: memory.nodePath,
					scope: memory.scope,
					...row,
					runId,
					stepId,
				})
				.onConflictDoUpdate({
					target: memoryKey,
					set: {
						hash: row.hash,
						value: row.value,
						runId,
						stepId,
						spaceId,
						updatedAt: now,
					},
				}),
		),
		capOf(db, projectId, memory),
	];
}

/**
 * A step's memory as another Replica logged it: what its `StepEnded`
 * names (`memory`), with its run's project and the time it ended.
 */
export type MemoryWrite = {
	spaceId: string;
	projectId: string;
	memory: StepMemory;
	runId: string;
	stepId: string;
	/** When the step ended, in ms since the epoch. */
	at: number;
};

/**
 * The statements that save the memory of steps another Replica walked, as
 * the exchange brings their `StepEnded`: the Replica that walks the next
 * run compares with it. A key saved here later than the step ended stays.
 */
export function saveMemoryWrites(
	db: Database,
	writes: readonly MemoryWrite[],
): BatchItem<"sqlite">[] {
	return writes.flatMap((write) => {
		const updatedAt = asDate(write.at);
		const rows = rowsOf(write.memory);
		if (rows.length === 0) return [];
		return [
			...rows.map((row) =>
				db
					.insert(nodeMemory)
					.values({
						spaceId: write.spaceId,
						projectId: write.projectId,
						rootFlow: write.memory.rootFlow,
						nodePath: write.memory.nodePath,
						scope: write.memory.scope,
						...row,
						runId: write.runId,
						stepId: write.stepId,
						updatedAt,
					})
					.onConflictDoUpdate({
						target: memoryKey,
						set: {
							hash: row.hash,
							value: row.value,
							runId: write.runId,
							stepId: write.stepId,
							spaceId: write.spaceId,
							updatedAt,
						},
						setWhere: lt(nodeMemory.updatedAt, updatedAt),
					}),
			),
			capOf(db, write.projectId, write.memory),
		];
	});
}

/** What the flow's Since last run nodes remember, one entry per node and scope. */
export async function listMemory(
	db: Database,
	flow: MemoryFlow,
): Promise<NodeMemory[]> {
	const ofFlow = and(
		eq(nodeMemory.spaceId, flow.spaceId),
		eq(nodeMemory.projectId, flow.projectId),
		eq(nodeMemory.rootFlow, flow.flowName),
	);
	const groups = await db
		.select({
			node: nodeMemory.nodePath,
			scope: nodeMemory.scope,
			keys: sql<number>`count(*)`,
			updatedAt: max(nodeMemory.updatedAt),
		})
		.from(nodeMemory)
		.where(ofFlow)
		.groupBy(nodeMemory.nodePath, nodeMemory.scope)
		.orderBy(nodeMemory.nodePath, nodeMemory.scope);
	const latest = await Promise.all(
		groups.map(async (group) => {
			const [row] = await db
				.select({
					itemKey: nodeMemory.itemKey,
					value: nodeMemory.value,
					runId: nodeMemory.runId,
					updatedAt: nodeMemory.updatedAt,
				})
				.from(nodeMemory)
				.where(
					and(
						ofFlow,
						eq(nodeMemory.nodePath, group.node),
						eq(nodeMemory.scope, group.scope),
					),
				)
				.orderBy(desc(nodeMemory.updatedAt))
				.limit(1);
			return row;
		}),
	);
	return groups.flatMap((group, index) => {
		const row = latest[index];
		if (!row) return [];
		return [
			{
				node: group.node,
				scope: group.scope,
				keys: Number(group.keys),
				...(row.value !== null ? { value: parse(row.value) } : {}),
				runId: row.runId,
				updatedAt: instant(row.updatedAt),
			},
		];
	});
}

/**
 * Forgets what a node saw: every scope, or one. The next run of the flow
 * is a first run for it again.
 */
export async function forgetMemory(
	db: Database,
	flow: MemoryFlow,
	node: string,
	scope?: string,
): Promise<void> {
	await db
		.delete(nodeMemory)
		.where(
			and(
				eq(nodeMemory.spaceId, flow.spaceId),
				eq(nodeMemory.projectId, flow.projectId),
				eq(nodeMemory.rootFlow, flow.flowName),
				eq(nodeMemory.nodePath, node),
				scope === undefined ? undefined : eq(nodeMemory.scope, scope),
			),
		);
}
