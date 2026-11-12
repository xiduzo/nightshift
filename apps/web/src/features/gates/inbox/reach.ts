import type { GateUrgency } from "@nightshift/flows";

/**
 * How a level of urgency reaches you: a notification too, or only the
 * inbox. Null while your settings load.
 */
export function reachText(
	urgency: GateUrgency,
	pushUrgencies: readonly GateUrgency[] | undefined,
): string | null {
	if (!pushUrgencies) return null;
	return pushUrgencies.includes(urgency)
		? "Night Shift also sends you a notification."
		: "Only here in the inbox.";
}
