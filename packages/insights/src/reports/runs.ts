import type { InsightsDb } from "../client";
import { usageRunTotals } from "../schema";
import { asNumber, ratio } from "./numbers";

export type RunNumbers = {
	/** Run ends. A resumed run that ends again counts again. */
	runs: number;
	finished: number;
	/** Runs with a useful answer. The latest answer of each run counts. */
	answered: number;
	useful: number;
	/** Useful runs divided by answered runs. Null when no run has an answer. */
	usefulRate: number | null;
	/**
	 * Every run's cost in USD divided by the useful runs: the cost of one
	 * useful result. Null when no run was useful.
	 */
	costPerUsefulResult: number | null;
	/**
	 * Run ends where a person stepped in, divided by the run ends that say.
	 * An older build does not say. Null when no run end says.
	 */
	neededYouRate: number | null;
};

/** The run, useful and needed-you numbers the pages share. */
export async function runNumbers(db: InsightsDb): Promise<RunNumbers> {
	const [row] = await db.select().from(usageRunTotals);
	const useful = asNumber(row?.useful);
	const answered = asNumber(row?.answered);
	return {
		runs: asNumber(row?.runs),
		finished: asNumber(row?.finished),
		answered,
		useful,
		usefulRate: ratio(useful, answered),
		costPerUsefulResult: ratio(asNumber(row?.costUsd), useful),
		neededYouRate: ratio(
			asNumber(row?.neededYou),
			asNumber(row?.reportedNeededYou),
		),
	};
}
