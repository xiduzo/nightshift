import { asc, desc } from "drizzle-orm";

import type { InsightsDb } from "../client";
import { usageGuard, usageRunEnding, usageRunNight } from "../schema";
import { asNumber, ratio } from "./numbers";

export type Nights = {
	/** Runs on each UTC night, oldest first. */
	runsPerNight: { night: string; runs: number }[];
	/** How runs end. A missing reason is null. */
	endings: { endReason: string | null; runs: number }[];
	/**
	 * Share of all runs stopped by each guard. Guards that never fired are 0.
	 * `share` is null when there are no runs.
	 */
	guards: { guard: string; runs: number; share: number | null }[];
};

export async function nights(db: InsightsDb): Promise<Nights> {
	const nightsRows = await db
		.select()
		.from(usageRunNight)
		.orderBy(asc(usageRunNight.night));
	const endings = await db
		.select()
		.from(usageRunEnding)
		.orderBy(desc(usageRunEnding.runs));
	const guardRows = await db.select().from(usageGuard);
	const total = endings.reduce((sum, row) => sum + asNumber(row.runs), 0);
	return {
		runsPerNight: nightsRows.map((row) => ({
			night: row.night,
			runs: asNumber(row.runs),
		})),
		endings: endings.map((row) => ({
			endReason: row.endReason,
			runs: asNumber(row.runs),
		})),
		guards: guardRows
			.map((row) => ({
				guard: row.guard,
				runs: asNumber(row.runs),
				share: ratio(asNumber(row.runs), total),
			}))
			.sort((a, b) => a.guard.localeCompare(b.guard)),
	};
}
