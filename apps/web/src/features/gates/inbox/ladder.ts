import type { OpenGate } from "@/shared/api";
import { type GateUrgency, URGENCIES } from "@/shared/urgency";

/** One rung of the inbox ladder: the open Gates of one urgency. */
export type LadderGroup<G> = { urgency: GateUrgency; gates: G[] };

/**
 * The open Gates as the inbox lists them: Now, then Today, then When you
 * have time, the oldest Gate first in each. Levels without a Gate are left out.
 */
export function ladderOf<G extends Pick<OpenGate, "urgency" | "openedAt">>(
	gates: readonly G[],
): LadderGroup<G>[] {
	return URGENCIES.map((urgency) => ({
		urgency,
		gates: gates
			.filter((gate) => gate.urgency === urgency)
			.sort((a, b) => a.openedAt - b.openedAt),
	})).filter((group) => group.gates.length > 0);
}

/**
 * How a level of the ladder reaches you: a notification too, or only the
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
