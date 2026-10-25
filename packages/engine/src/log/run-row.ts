import type { Database } from "@nightshift/db";
import { event, run, step } from "@nightshift/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { LoggedEvent } from "./events";

/**
 * The run's row: what a run is beside its event log (its project, flow
 * snapshot, worktree and Device), and the rows of its steps.
 */

export type RunRow = typeof run.$inferSelect;

/**
 * Where a run's steps run, decided once when it starts
 * (`PlacementPort.plan`) and kept on its row: the walk reads it
 * (`planOf`) and decides nothing.
 */
export type RunPlan = {
	/** The run's Device: its worktree, and the steps of every node that names no Device. */
	device: PlannedDevice;
	/** The Devices the nodes name (`device`), by that name. */
	named: Record<string, PlannedDevice>;
	/**
	 * The Person the run runs for, as the Host of its Space knows them:
	 * every Device of the plan serves its steps for them. Null only for a
	 * run another Replica walked before every run had one.
	 */
	personId: string | null;
};

/** A Device of a run's plan. Its name is null for a run from before the plan kept names. */
export type PlannedDevice = { id: string; name: string | null };

/** A JSON object of strings from a column, or an empty one. */
function stringsOf(text: string | null): Record<string, string> {
	if (!text) return {};
	try {
		const parsed: unknown = JSON.parse(text);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}

/**
 * The run's plan, from the columns of its row that keep it: `device_id`
 * (null before Placement: the Walker), `placements`, `device_names` and
 * `started_by`. A run from before the plan, or from a Device of a version
 * before it, has no names: the walk names its Devices as the nodes do.
 */
export function planOf(
	row: Pick<
		RunRow,
		"deviceId" | "walkerId" | "placements" | "deviceNames" | "startedBy"
	>,
): RunPlan {
	const names = stringsOf(row.deviceNames);
	const at = (id: string): PlannedDevice => ({ id, name: names[id] ?? null });
	return {
		device: at(row.deviceId ?? row.walkerId),
		named: Object.fromEntries(
			Object.entries(stringsOf(row.placements)).map(([name, id]) => [
				name,
				at(id),
			]),
		),
		personId: row.startedBy,
	};
}

/**
 * The columns of a run's row that keep its plan. `placements` keeps its
 * shape (name to id), so a Replica of a version before the plan reads it.
 */
export function planColumns(
	plan: RunPlan,
): Pick<RunRow, "deviceId" | "placements" | "deviceNames" | "startedBy"> {
	const named = Object.entries(plan.named);
	const names = Object.fromEntries(
		[plan.device, ...named.map(([, at]) => at)].flatMap((at) =>
			at.name === null ? [] : [[at.id, at.name]],
		),
	);
	return {
		deviceId: plan.device.id,
		placements:
			named.length > 0
				? JSON.stringify(
						Object.fromEntries(named.map(([name, at]) => [name, at.id])),
					)
				: null,
		deviceNames: Object.keys(names).length > 0 ? JSON.stringify(names) : null,
		startedBy: plan.personId,
	};
}

/** The run's row, or an error naming the run. */
export async function getRunRow(db: Database, runId: string): Promise<RunRow> {
	const [row] = await db.select().from(run).where(eq(run.id, runId));
	if (!row) throw new Error(`Run not found: ${runId}`);
	return row;
}

/** The Space of the run, or null when this Replica has no run of that id. */
export async function spaceOfRun(
	db: Database,
	runId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ spaceId: run.spaceId })
		.from(run)
		.where(eq(run.id, runId));
	return row?.spaceId ?? null;
}

/** Whether this Replica has the run's row. */
export async function hasRunRow(db: Database, runId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: run.id })
		.from(run)
		.where(eq(run.id, runId));
	return row !== undefined;
}

/**
 * Applies `WalkerMoved` to the run rows: the run's Walker is the latest
 * `to`. A run from before Placement keeps its steps' Device: the Walker it
 * had.
 */
export async function applyWalkerMoves(
	db: Database,
	events: readonly LoggedEvent[],
): Promise<void> {
	const runIds = events.flatMap((e) =>
		e.type === "WalkerMoved" && e.runId ? [e.runId] : [],
	);
	if (runIds.length > 0) await followWalkerMoves(db, runIds);
}

/**
 * The statement that gives each of the runs the Walker its log names: the
 * `to` of its latest `WalkerMoved`. It reads the log, not the events that
 * just came, so it repeats safely: a run whose Walker already follows its
 * log is not touched. A run from before Placement keeps its steps'
 * Device: the Walker it had.
 */
export function followWalkerMoves(db: Database, runIds: readonly string[]) {
	const latestTo = sql<string>`(select json_extract(${event.payload}, '$.to') from ${event} where ${event.runId} = ${run.id} and ${event.type} = 'WalkerMoved' order by ${event.seq} desc limit 1)`;
	return db
		.update(run)
		.set({
			deviceId: sql`coalesce(${run.deviceId}, ${run.walkerId})`,
			walkerId: latestTo,
		})
		.where(
			and(
				inArray(run.id, [...runIds]),
				sql`${latestTo} is not null`,
				sql`${run.walkerId} is not ${latestTo}`,
			),
		);
}

/**
 * The runs that moved to one of `here` and have not arrived: their latest
 * `WalkerMoved` names one of them, and none of them wrote to the run
 * since. The new Walker's first event there is `WalkerArrived`, once it
 * has the run's Walk state. With `among`, only those runs are looked at.
 */
export async function runsArriving(
	db: Database,
	here: readonly string[],
	among?: readonly string[],
): Promise<string[]> {
	if (here.length === 0 || among?.length === 0) return [];
	const lastMove = sql`(select max(w.seq) from ${event} w where w.run_id = ${run.id} and w.type = 'WalkerMoved')`;
	const rows = await db
		.select({ id: run.id })
		.from(run)
		.where(
			and(
				among ? inArray(run.id, [...among]) : undefined,
				inArray(run.walkerId, [...here]),
				sql`(select json_extract(m.payload, '$.to') from ${event} m where m.seq = ${lastMove}) in ${[...here]}`,
				sql`not exists (select 1 from ${event} a where a.run_id = ${run.id} and a.walker_id in ${[...here]} and a.seq > ${lastMove})`,
			),
		);
	return rows.map((r) => r.id);
}

/** The ids of the project's runs. */
export async function runIdsOfProject(
	db: Database,
	projectId: string,
): Promise<string[]> {
	const rows = await db
		.select({ id: run.id })
		.from(run)
		.where(eq(run.projectId, projectId));
	return rows.map((r) => r.id);
}

/** The ids of the runs a Device walks. */
export async function runIdsWalkedBy(
	db: Database,
	walkerId: string,
): Promise<string[]> {
	const rows = await db
		.select({ id: run.id })
		.from(run)
		.where(eq(run.walkerId, walkerId));
	return rows.map((r) => r.id);
}

/** The ids of the run's steps. */
export async function stepIdsOfRun(
	db: Database,
	runId: string,
): Promise<string[]> {
	const rows = await db
		.select({ id: step.id })
		.from(step)
		.where(eq(step.runId, runId));
	return rows.map((s) => s.id);
}
