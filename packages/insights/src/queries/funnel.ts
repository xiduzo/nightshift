import { asc } from "drizzle-orm";

import type { InsightsDb } from "../client";
import { usageFunnelStep, usageTimeToFirst } from "../schema";
import { asNumber, asNumberOrNull } from "./numbers";

const STEPS = [
	"install",
	"agent",
	"project",
	"checked",
	"flow",
	"schedule",
	"run",
	"finished",
	"useful",
] as const;

export type Funnel = {
	/**
	 * The setup funnel, in order. `stopped` is the installs whose next step
	 * never happened. The last step has no next step, so its `stopped` is 0.
	 */
	steps: {
		step: (typeof STEPS)[number];
		installs: number;
		stopped: number;
		medianSecondsFromInstall: number | null;
		medianSecondsFromPrevious: number | null;
	}[];
	/** From install to the first finished run, even when a setup step was skipped. */
	medianSecondsToFirstFinishedRun: number | null;
	/** From install to the first run a person found useful. */
	medianSecondsToFirstUsefulRun: number | null;
};

export async function funnel(db: InsightsDb): Promise<Funnel> {
	const steps = await db
		.select()
		.from(usageFunnelStep)
		.orderBy(asc(usageFunnelStep.stepOrder));
	const [time] = await db.select().from(usageTimeToFirst);
	const byStep = new Map(steps.map((row) => [row.step, row]));
	return {
		steps: STEPS.map((step) => {
			const row = byStep.get(step);
			return {
				step,
				installs: asNumber(row?.installs),
				stopped: asNumber(row?.stopped),
				medianSecondsFromInstall: asNumberOrNull(row?.medianSecondsFromInstall),
				medianSecondsFromPrevious: asNumberOrNull(
					row?.medianSecondsFromPrevious,
				),
			};
		}),
		medianSecondsToFirstFinishedRun: asNumberOrNull(
			time?.medianSecondsToFinished,
		),
		medianSecondsToFirstUsefulRun: asNumberOrNull(time?.medianSecondsToUseful),
	};
}
