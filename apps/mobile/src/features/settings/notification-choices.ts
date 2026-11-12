import { localZone } from "@nightshift/client";
import { GATE_URGENCIES, type GateUrgency } from "@nightshift/flows";

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
 * Whether `urgency` is the only level that is on. Its switch stays on, as
 * on the web: turning off every Gate push is the Gates switch.
 */
export function isLastPushUrgency(
	current: readonly GateUrgency[],
	urgency: GateUrgency,
): boolean {
	return current.length === 1 && current[0] === urgency;
}

/**
 * The urgencies that push a Gate after one switch of "Push for" changes,
 * in the order now, today, later. The last level that is on stays on.
 */
export function pushUrgenciesWith(
	current: readonly GateUrgency[],
	urgency: GateUrgency,
	on: boolean,
): GateUrgency[] {
	const next = GATE_URGENCIES.filter((level) =>
		level === urgency ? on : current.includes(level),
	);
	return next.length > 0
		? next
		: GATE_URGENCIES.filter((level) => current.includes(level));
}
