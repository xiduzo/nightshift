import type { OpenGate } from "@/shared/api";

/** How soon a Gate needs an answer. */
export type GateUrgency = OpenGate["urgency"];

/** The urgency levels, the most urgent first. */
export const URGENCIES: readonly GateUrgency[] = ["now", "today", "later"];

/** What the person reads for each level. */
export const URGENCY_LABEL: Record<GateUrgency, string> = {
	now: "Now",
	today: "Today",
	later: "When you have time",
};
