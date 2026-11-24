import { asc } from "drizzle-orm";

import type { InsightsDb } from "../client";
import { usageCohort, usageDaysPerWeek, usageWeek } from "../schema";
import { asNumber, asNumberOrNull, ratio } from "./numbers";

export type Retention = {
	weeks: {
		week: string;
		/** Installs with any event that week. */
		activeInstalls: number;
		/** Installs with a run that week. */
		installsWithRuns: number;
		/** Install-days with a run. */
		days: number;
		/** Days with a run divided by installs that ran. Null when none ran. */
		daysPerInstall: number | null;
	}[];
	/** Mean of `daysPerInstall` across weeks that had a run. Null when none did. */
	daysPerWeek: number | null;
	/**
	 * Installs with a run in week 4, divided by the cohort, across cohorts old
	 * enough to have a week 4. Null when no cohort is that old.
	 */
	week4Retention: number | null;
	/** Cohorts by the UTC week of the first run. `retainedWeek4` is null until that week has arrived. */
	cohorts: {
		week: string;
		size: number;
		retainedWeek4: number | null;
	}[];
};

export async function retention(db: InsightsDb): Promise<Retention> {
	const weeks = await db.select().from(usageWeek).orderBy(asc(usageWeek.week));
	const cohorts = await db
		.select()
		.from(usageCohort)
		.orderBy(asc(usageCohort.week));
	const [pace] = await db.select().from(usageDaysPerWeek);
	let matureSize = 0;
	let matureRetained = 0;
	let anyMature = false;
	const cohortRows = cohorts.map((row) => {
		const size = asNumber(row.size);
		const retained = asNumber(row.retainedWeek4);
		if (row.mature) {
			anyMature = true;
			matureSize += size;
			matureRetained += retained;
		}
		return {
			week: row.week,
			size,
			retainedWeek4: row.mature ? retained : null,
		};
	});
	return {
		weeks: weeks.map((row) => {
			const installsWithRuns = asNumber(row.installsWithRuns);
			const days = asNumber(row.days);
			return {
				week: row.week,
				activeInstalls: asNumber(row.activeInstalls),
				installsWithRuns,
				days,
				daysPerInstall: ratio(days, installsWithRuns),
			};
		}),
		daysPerWeek: asNumberOrNull(pace?.daysPerWeek),
		week4Retention: anyMature ? ratio(matureRetained, matureSize) : null,
		cohorts: cohortRows,
	};
}
