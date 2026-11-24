import type { Database } from "@nightshift/db";
import { event, run } from "@nightshift/db/schema";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { closeOpenWork, type RunHolds } from "../../../../graph";
import {
	type EngineEventType,
	groupByRun,
	parseEventRow,
	runsArriving,
} from "../../../../log";
import type { OpenWork } from "../../application/ports";
import { LIFECYCLE_EVENT_TYPES } from "../../domain/lifecycle-events";

/** What a cut of a run's open work needs: the run log, the run bus and the run's flows. */
type CloseDeps = Parameters<typeof closeOpenWork>[0];

/** What the open work of this computer stands on. */
export type DrizzleOpenWorkDeps = Omit<CloseDeps, "holds"> & {
	db: Database;
	/**
	 * What runs hold for a scope (leases). An interrupted run keeps them for
	 * its resume. One that does not continue lets go.
	 */
	runHolds: RunHolds;
};

/** The work the last daemon left open, over the engine's database and the run log. */
export function drizzleOpenWork(deps: DrizzleOpenWorkDeps): OpenWork {
	const { db, log } = deps;
	return {
		async walkedHere() {
			// Only the runs this Device walks, as their rows say: a run walked
			// elsewhere is its Walker's to recover. A run moved here has the
			// events of its old Walker too, and a run moved away is not ours.
			const self = await log.walkerId();
			const walkedHere = db
				.select({ id: run.id })
				.from(run)
				.where(eq(run.walkerId, self));
			const rows = await db
				.select()
				.from(event)
				.where(
					and(
						isNotNull(event.runId),
						inArray(event.runId, walkedHere),
						inArray(event.type, [
							...LIFECYCLE_EVENT_TYPES,
						] satisfies EngineEventType[]),
					),
				)
				.orderBy(asc(event.seq));
			// A run that moved here and has not arrived: its take-over gives it
			// its walk state and its timer, once the engine is ready.
			const arriving = new Set(await runsArriving(db, [self]));
			const byRun = groupByRun(rows.map(parseEventRow));
			for (const runId of arriving) byRun.delete(runId);
			return byRun;
		},
		close: (runId, cut) =>
			closeOpenWork({ ...deps, holds: deps.runHolds }, runId, cut),
		letGo: (runId) => deps.runHolds.notContinuing(runId),
	};
}
