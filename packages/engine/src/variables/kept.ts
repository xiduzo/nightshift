import type { Database } from "@nightshift/db";
import { keptVariable } from "@nightshift/db/schema";
import type { Flow, JsonValue } from "@nightshift/flows";
import { and, asc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

/**
 * Kept variables (`keep: "project"`): the value a variable has between
 * runs, one per project, flow and variable name. The walk reads them when
 * a flow starts (`vars__init`) and saves each write of one in the batch of
 * the step's `StepEnded`, so a step never ends without its kept value, or
 * the reverse. Two steps that write at once (parallel branches, two runs)
 * each save theirs: the last to end wins. A person reads them on the flow's
 * page and resets one there: the next run starts from `initial` again.
 *
 * The run's own history of the values stays in its events (`VariablesSet`,
 * `StepEnded.variables`), so a resume reads the log, never this table.
 */

/** A kept value as a person sees it on the flow's page. */
export type KeptValue = {
	name: string;
	value: JsonValue;
	/** The run whose step saved it last. */
	runId: string;
	/** When it was saved, in ms since the epoch. */
	updatedAt: number;
};

/** Which flow's kept values: a project and a flow file's name. */
export type KeptFlow = { spaceId: string; projectId: string; flowName: string };

/** The names of the flow's variables that are kept between runs. */
export function keptNames(flow: Pick<Flow, "variables">): Set<string> {
	return new Set(
		(flow.variables ?? [])
			.filter((variable) => variable.keep !== undefined)
			.map((variable) => variable.name),
	);
}

function parse(value: string): JsonValue {
	try {
		return JSON.parse(value) as JsonValue;
	} catch {
		return null;
	}
}

/** The flow's kept values, by name, oldest name first. */
export async function listKeptValues(
	db: Database,
	flow: KeptFlow,
): Promise<KeptValue[]> {
	const rows = await db
		.select()
		.from(keptVariable)
		.where(
			and(
				eq(keptVariable.spaceId, flow.spaceId),
				eq(keptVariable.projectId, flow.projectId),
				eq(keptVariable.flowName, flow.flowName),
			),
		)
		.orderBy(asc(keptVariable.name));
	return rows.map((row) => ({
		name: row.name,
		value: parse(row.value),
		runId: row.runId,
		updatedAt: row.updatedAt.getTime(),
	}));
}

/** The flow's kept values as a run starts from them: by name. */
export async function keptValues(
	db: Database,
	flow: KeptFlow,
): Promise<Record<string, JsonValue>> {
	const values: Record<string, JsonValue> = {};
	for (const kept of await listKeptValues(db, flow)) {
		values[kept.name] = kept.value;
	}
	return values;
}

/**
 * The statements that save a step's writes of kept variables, for the
 * batch of its `StepEnded`. Only the names in `kept` are saved.
 */
export function saveKeptValues(
	db: Database,
	flow: KeptFlow,
	kept: ReadonlySet<string>,
	written: Readonly<Record<string, JsonValue>>,
	by: { runId: string; stepId: string },
): BatchItem<"sqlite">[] {
	return Object.entries(written)
		.filter(([name]) => kept.has(name))
		.map(([name, value]) => {
			const json = JSON.stringify(value);
			return db
				.insert(keptVariable)
				.values({ ...flow, name, value: json, ...by })
				.onConflictDoUpdate({
					target: [
						keptVariable.projectId,
						keptVariable.flowName,
						keptVariable.name,
					],
					set: {
						value: json,
						runId: by.runId,
						stepId: by.stepId,
						spaceId: flow.spaceId,
						updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
					},
				});
		});
}

/** Forgets one kept value: the next run starts the variable from `initial`. */
export async function resetKeptValue(
	db: Database,
	flow: KeptFlow,
	name: string,
): Promise<void> {
	await db
		.delete(keptVariable)
		.where(
			and(
				eq(keptVariable.spaceId, flow.spaceId),
				eq(keptVariable.projectId, flow.projectId),
				eq(keptVariable.flowName, flow.flowName),
				eq(keptVariable.name, name),
			),
		);
}
