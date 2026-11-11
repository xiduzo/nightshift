import { localZone } from "@nightshift/client";
import type { GateUrgency } from "@nightshift/flows";

import { URGENCIES } from "@/shared/urgency";

/**
 * What Settings offers to choose, without React Native: the hours, the
 * phone's time zone, and the urgencies that push a Gate.
 */

/** Every hour of the day, `00:00` to `23:00`. */
export const HOURS = Array.from(
	{ length: 24 },
	(_, hour) => `${String(hour).padStart(2, "0")}:00`,
);

/** One choice of a Select in Settings: a time or a delay. */
export type Choice = { value: string; label: string };

/** The phone's time zone, for quiet hours. */
export function phoneTimeZone(): string {
	return localZone();
}

/** A Host older than "Push for" sends none: it pushes the Gates for now only. */
export const DEFAULT_PUSH_URGENCIES: readonly GateUrgency[] = ["now"];

/**
 * The urgencies that push a Gate after one switch of "Push for" changes,
 * in the order now, today, later.
 */
export function pushUrgenciesWith(
	current: readonly GateUrgency[],
	urgency: GateUrgency,
	on: boolean,
): GateUrgency[] {
	return URGENCIES.filter((level) =>
		level === urgency ? on : current.includes(level),
	);
}
