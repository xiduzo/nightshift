import { GATE_URGENCIES, type GateUrgency } from "@nightshift/flows";

/**
 * How soon a Gate needs you, without React Native: the three levels in
 * the order Needs you shows them, and their words.
 */

/** Now, today, later: the order of the Needs you sections and of "Push for". */
export const URGENCIES: readonly GateUrgency[] = GATE_URGENCIES;

/** The word of each urgency: "Now", "Today", "When you have time". */
export const URGENCY_LABEL: Record<GateUrgency, string> = {
	now: "Now",
	today: "Today",
	later: "When you have time",
};

/**
 * A Gate's urgency. A Host older than the brief sends none: its Gates read
 * as today, as an old run does.
 */
export function urgencyOf(gate: { urgency?: GateUrgency }): GateUrgency {
	return gate.urgency ?? "today";
}
