import { asc, desc } from "drizzle-orm";

import type { InsightsDb } from "../client";
import { usageGuard, usageRunDay, usageRunEnding } from "../schema";
import { asNumber, ratio } from "./numbers";

export type Days = {
	/** Runs on each UTC day, oldest first. */
	runsPerDay: { day: string; runs: number }[];
	/** How runs end. A missing reason is null. */
	endings: { endReason: string | null; runs: number }[];
	/**
	 * Share of all runs stopped by each guard. Guards that never fired are 0.
	 * `share` is null when there are no runs.
	 */
	guards: { guard: string; runs: number; share: number | null }[];
};

export async function days(db: InsightsDb): Promise<Days> {
	const dayRows = await db
		.select()
		.from(usageRunDay)
		.orderBy(asc(usageRunDay.day));
	const endings = await db
		.select()
		.from(usageRunEnding)
		.orderBy(desc(usageRunEnding.runs));
	const guardRows = await db.select().from(usageGuard);
	const total = endings.reduce((sum, row) => sum + asNumber(row.runs), 0);
	return {
		runsPerDay: dayRows.map((row) => ({
			day: row.day,
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
