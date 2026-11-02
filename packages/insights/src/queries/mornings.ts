import { asc } from "drizzle-orm";

import type { InsightsDb } from "../client";
import {
	usageFlaggedInstall,
	usageGates,
	usagePullRequestTotals,
	usagePullRequestWeek,
} from "../schema";
import { asNumber, asNumberOrNull, ratio } from "./numbers";

export type Mornings = {
	opened: number;
	merged: number;
	closed: number;
	reverted: number;
	/** Reverted with an outcome within 7 days. */
	revertedWithin7Days: number;
	/** Merged divided by opened. Null when nothing was opened. */
	mergedRate: number | null;
	/** Reverted within 7 days divided by merged. Null when nothing was merged. */
	revertedRate: number | null;
	/**
	 * Sum of run cost in USD divided by merged pull requests.
	 * An outcome event does not name its run, so the cost is every run's cost.
	 * Null when nothing was merged.
	 */
	costPerMergedPullRequest: number | null;
	/** Opened, merged, closed and reverted for one install in one UTC week. */
	byInstallWeek: {
		installId: string;
		week: string;
		opened: number;
		merged: number;
		closed: number;
		reverted: number;
		/** The install's daily event count is more than 10 times the median. */
		flagged: boolean;
	}[];
	gates: {
		byPerson: number;
		byDeadline: number;
		/** Median of the gate wait, in seconds. Null when no gate was answered. */
		medianWaitSeconds: number | null;
		phone: number;
		/** Web and lock screen. */
		desktop: number;
		web: number;
		lockScreen: number;
		other: number;
	};
};

export async function mornings(db: InsightsDb): Promise<Mornings> {
	const [pulls] = await db.select().from(usagePullRequestTotals);
	const [gates] = await db.select().from(usageGates);
	const weeks = await db
		.select()
		.from(usagePullRequestWeek)
		.orderBy(
			asc(usagePullRequestWeek.week),
			asc(usagePullRequestWeek.installId),
		);
	const flagged = new Set(
		(await db.select().from(usageFlaggedInstall)).map((row) => row.installId),
	);
	const opened = asNumber(pulls?.opened);
	const merged = asNumber(pulls?.merged);
	const revertedWithin7Days = asNumber(pulls?.revertedWithin7Days);
	const web = asNumber(gates?.web);
	const lockScreen = asNumber(gates?.lockScreen);
	return {
		opened,
		merged,
		closed: asNumber(pulls?.closed),
		reverted: asNumber(pulls?.reverted),
		revertedWithin7Days,
		mergedRate: ratio(merged, opened),
		revertedRate: ratio(revertedWithin7Days, merged),
		costPerMergedPullRequest:
			merged === 0 ? null : asNumber(pulls?.costUsd) / merged,
		byInstallWeek: weeks.flatMap((row) => {
			if (!row.installId || !row.week) return [];
			return [
				{
					installId: row.installId,
					week: row.week,
					opened: asNumber(row.opened),
					merged: asNumber(row.merged),
					closed: asNumber(row.closed),
					reverted: asNumber(row.reverted),
					flagged: flagged.has(row.installId),
				},
			];
		}),
		gates: {
			byPerson: asNumber(gates?.byPerson),
			byDeadline: asNumber(gates?.byDeadline),
			medianWaitSeconds: asNumberOrNull(gates?.medianWaitSeconds),
			phone: asNumber(gates?.phone),
			desktop: web + lockScreen,
			web,
			lockScreen,
			other: asNumber(gates?.other),
		},
	};
}
