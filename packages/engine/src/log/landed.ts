import type { Database } from "@nightshift/db";
import { run } from "@nightshift/db/schema";
import { inArray } from "drizzle-orm";

import type { LoggedEvent } from "./events";
import type { RunLog } from "./run-log";

/** An event of a run that landed in this Replica's log, with the run's Space. */
export type LandedRunEvent = LoggedEvent & { runId: string; spaceId: string };

/** Called with the run events of one landing, in seq order. */
export type LandedRunListener = (events: readonly LandedRunEvent[]) => void;

/**
 * Tells `listener` about every run event that lands in this Replica: those
 * this computer appends, and those the exchange brings from other Walkers.
 * Each event gets its run's Space, read when it lands (a project can move
 * to another Space). Facts of no run are left out. Landings reach the
 * listener in the order they landed. Returns the unsubscribe.
 */
export function onLandedRunEvents(
	db: Database,
	log: RunLog,
	listener: LandedRunListener,
): () => void {
	let queue = Promise.resolve();
	let stopped = false;
	const off = log.onLanded((events) => {
		const ofRuns = events.filter(
			(e): e is LoggedEvent & { runId: string } => e.runId !== null,
		);
		if (ofRuns.length === 0) return;
		queue = queue
			.then(async () => {
				if (stopped) return;
				const ids = [...new Set(ofRuns.map((e) => e.runId))];
				const rows = await db
					.select({ id: run.id, spaceId: run.spaceId })
					.from(run)
					.where(inArray(run.id, ids));
				const spaceOf = new Map(rows.map((r) => [r.id, r.spaceId]));
				const landed: LandedRunEvent[] = [];
				for (const e of ofRuns) {
					const spaceId = spaceOf.get(e.runId);
					if (spaceId !== undefined) landed.push({ ...e, spaceId });
				}
				if (landed.length > 0 && !stopped) listener(landed);
			})
			.catch((error) => {
				console.error("[engine] a listener of new run events failed:", error);
			});
	});
	return () => {
		stopped = true;
		off();
	};
}
