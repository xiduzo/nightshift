import { GATE_URGENCIES, type GateUrgency } from "@nightshift/flows";

import type { OpenGate } from "./types";

/**
 * The Gate queue of both apps (ADR 21): how soon each Gate needs you, its
 * words, the one order of the open Gates, and which of them you may
 * answer. The web inbox and the phone's Needs you show the Gates in this
 * order.
 */

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

type Queued = { urgency?: GateUrgency } & Pick<
	OpenGate,
	"deadline" | "openedAt"
>;

/** The deadline of a Gate, or the end of time without one: for the order. */
function deadlineOf(gate: Queued): number {
	return gate.deadline?.at ?? Number.POSITIVE_INFINITY;
}

function rankOf(gate: Queued): number {
	return GATE_URGENCIES.indexOf(urgencyOf(gate));
}

/**
 * The open Gates in queue order: the Gates for now first, then for
 * today, then for when you have time. In each, the first to close first.
 * The Gates without a deadline follow, the oldest first. Gates that tie
 * keep the order the Host sent.
 */
export function gateOrder<G extends Queued>(gates: readonly G[]): G[] {
	return [...gates].sort(
		(a, b) =>
			rankOf(a) - rankOf(b) ||
			deadlineOf(a) - deadlineOf(b) ||
			a.openedAt - b.openedAt,
	);
}

/** You may answer this Gate: your role lets you, and nobody answered it yet. */
export function mayAnswer(
	gate: Pick<OpenGate, "canAnswer" | "answerPending">,
): boolean {
	return gate.canAnswer && !gate.answerPending;
}
