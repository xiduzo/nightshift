import { asc } from "drizzle-orm";

import type { InsightsDb } from "../client";
import {
	usageFlaggedInstall,
	usageGates,
	usagePullRequestTotals,
	usagePullRequestWeek,
} from "../schema";
import { asNumber, asNumberOrNull, ratio } from "./numbers";
import { runNumbers } from "./runs";

export type Feedback = {
	/** Finished runs, the question every one of them asks. */
	finished: number;
	/** Runs with a useful answer. The latest answer of each run counts. */
	answered: number;
	useful: number;
	/** Useful divided by answered. Null when no run has an answer. */
	usefulRate: number | null;
	/** Every run's cost in USD divided by useful runs. Null when none was useful. */
	costPerUsefulResult: number | null;
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
	/**
	 * The code scorer: what became of the pull requests runs opened. Only a
	 * schedule that scores pull requests writes these.
	 */
	pullRequests: {
		merged: number;
		closed: number;
		revertedWithin7Days: number;
		/** Reverted within 7 days divided by merged. Null when nothing was merged. */
		revertedRate: number | null;
		/** Merged, closed and reverted for one install in one UTC week. */
		byInstallWeek: {
			installId: string;
			week: string;
			merged: number;
			closed: number;
			revertedWithin7Days: number;
			/** The install's daily event count is more than 10 times the median. */
			flagged: boolean;
		}[];
	};
};

export async function feedback(db: InsightsDb): Promise<Feedback> {
	const runs = await runNumbers(db);
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
	const merged = asNumber(pulls?.merged);
	const revertedWithin7Days = asNumber(pulls?.revertedWithin7Days);
	const web = asNumber(gates?.web);
	const lockScreen = asNumber(gates?.lockScreen);
	return {
		finished: runs.finished,
		answered: runs.answered,
		useful: runs.useful,
		usefulRate: runs.usefulRate,
		costPerUsefulResult: runs.costPerUsefulResult,
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
		pullRequests: {
			merged,
			closed: asNumber(pulls?.closed),
			revertedWithin7Days,
			revertedRate: ratio(revertedWithin7Days, merged),
			byInstallWeek: weeks.flatMap((row) => {
				if (!row.installId || !row.week) return [];
				return [
					{
						installId: row.installId,
						week: row.week,
						merged: asNumber(row.merged),
						closed: asNumber(row.closed),
						revertedWithin7Days: asNumber(row.revertedWithin7Days),
						flagged: flagged.has(row.installId),
					},
				];
			}),
		},
	};
}
