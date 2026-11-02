import { asc } from "drizzle-orm";

import type { InsightsDb } from "../client";
import {
	usageFlaggedInstall,
	usagePullRequestTotals,
	usageThisWeek,
} from "../schema";
import { asNumber, ratio } from "./numbers";

export type Overview = {
	/** Distinct installs with an event in the current UTC week. */
	activeInstallsThisWeek: number;
	/** Install-nights with a run in the current UTC week. */
	nightsWithRunsThisWeek: number;
	openedPullRequests: number;
	mergedPullRequests: number;
	/** Merged divided by opened. Null when nothing was opened. */
	mergedRate: number | null;
	/**
	 * Sum of run cost in USD divided by merged pull requests.
	 * An outcome event does not name its run, so the cost is every run's cost.
	 * Null when nothing was merged.
	 */
	costPerMergedPullRequest: number | null;
	/** Installs whose daily event count is more than 10 times the median. */
	flaggedInstallIds: string[];
};

export async function overview(db: InsightsDb): Promise<Overview> {
	const [week] = await db.select().from(usageThisWeek);
	const [pulls] = await db.select().from(usagePullRequestTotals);
	const flagged = await db
		.select()
		.from(usageFlaggedInstall)
		.orderBy(asc(usageFlaggedInstall.installId));
	const opened = asNumber(pulls?.opened);
	const merged = asNumber(pulls?.merged);
	const cost = asNumber(pulls?.costUsd);
	return {
		activeInstallsThisWeek: asNumber(week?.activeInstalls),
		nightsWithRunsThisWeek: asNumber(week?.nightsWithRuns),
		openedPullRequests: opened,
		mergedPullRequests: merged,
		mergedRate: ratio(merged, opened),
		costPerMergedPullRequest: merged === 0 ? null : cost / merged,
		flaggedInstallIds: flagged
			.map((row) => row.installId)
			.filter((id): id is string => id != null),
	};
}
