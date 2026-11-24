import { asc } from "drizzle-orm";

import type { InsightsDb } from "../client";
import { usageFlaggedInstall, usageThisWeek } from "../schema";
import { asNumber } from "./numbers";
import { runNumbers } from "./runs";

export type Overview = {
	/** Distinct installs with an event in the current UTC week. */
	activeInstallsThisWeek: number;
	/** Install-days with a run in the current UTC week. */
	daysWithRunsThisWeek: number;
	finishedRuns: number;
	/** Runs a person found useful. The latest answer of each run counts. */
	usefulRuns: number;
	/** Useful runs divided by answered runs. Null when no run has an answer. */
	usefulRate: number | null;
	/** Every run's cost in USD divided by useful runs. Null when none was useful. */
	costPerUsefulResult: number | null;
	/** Run ends where a person stepped in. Null when no run end says. */
	neededYouRate: number | null;
	/** Installs whose daily event count is more than 10 times the median. */
	flaggedInstallIds: string[];
};

export async function overview(db: InsightsDb): Promise<Overview> {
	const [week] = await db.select().from(usageThisWeek);
	const runs = await runNumbers(db);
	const flagged = await db
		.select()
		.from(usageFlaggedInstall)
		.orderBy(asc(usageFlaggedInstall.installId));
	return {
		activeInstallsThisWeek: asNumber(week?.activeInstalls),
		daysWithRunsThisWeek: asNumber(week?.daysWithRuns),
		finishedRuns: runs.finished,
		usefulRuns: runs.useful,
		usefulRate: runs.usefulRate,
		costPerUsefulResult: runs.costPerUsefulResult,
		neededYouRate: runs.neededYouRate,
		flaggedInstallIds: flagged
			.map((row) => row.installId)
			.filter((id): id is string => id != null),
	};
}
