import type { Database } from "@nightshift/db";
import { event, run } from "@nightshift/db/schema";
import { and, eq } from "drizzle-orm";
import type { Hold, RunLog, RunState } from "../log";
import type { LeaseKeeper } from "./keeper";

/**
 * What a run holds at its keeper now, as its log says: the leases of a
 * living run, and those an interrupted run keeps for its resume. An ended
 * run holds none.
 */
function heldLeases(state: RunState): readonly Hold[] {
	const ended = state.latest?.ended;
	if (!ended) return state.holds;
	return ended.status === "interrupted" ? state.endedHolding : [];
}

/**
 * Tells the keeper which leases the runs this computer walks hold, from
 * their logs, when the engine starts: it renews them from then on. Only
 * the runs that ever took a lease are read.
 */
export async function trackHeldLeases(deps: {
	db: Database;
	log: Pick<RunLog, "walkerId" | "derive">;
	keeper: Pick<LeaseKeeper, "track">;
}): Promise<void> {
	const self = await deps.log.walkerId();
	const rows = await deps.db
		.selectDistinct({ runId: run.id, spaceId: run.spaceId })
		.from(event)
		.innerJoin(run, eq(run.id, event.runId))
		.where(and(eq(event.type, "LeaseTaken"), eq(run.walkerId, self)));
	const held = await deps.log.derive(
		rows.map((row) => row.runId),
		heldLeases,
	);
	for (const row of rows) {
		const leases = (held.get(row.runId) ?? []).filter(
			(hold) => hold.kind === "lease",
		);
		deps.keeper.track(
			row.runId,
			row.spaceId,
			leases.map((hold) => hold.name),
		);
	}
}

/**
 * A renewal found that the run lost these leases while it lived: the
 * Host did not hear from this Device for their ttl. The log of a living
 * run says so (`LeaseReleased` with `expired`) for each one it still
 * holds. An interrupted run hears it when it resumes: it takes the lease
 * back, or waits for a person.
 */
export async function leasesLost(
	deps: { log: Pick<RunLog, "state" | "append"> },
	runId: string,
	names: readonly string[],
): Promise<void> {
	const state = await deps.log.state(runId);
	if (state.latest?.ended) return;
	for (const hold of state.holds) {
		if (hold.kind !== "lease" || !names.includes(hold.name)) continue;
		await deps.log.append({
			type: "LeaseReleased",
			runId,
			payload: { name: hold.name, why: "expired" },
		});
	}
}
