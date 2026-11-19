import type { OpenGate } from "./views";

type Ordered = Pick<OpenGate, "openedAt" | "runId" | "stepId">;

/**
 * The order of every list of open Gates (a Space's, the Needs-you inbox):
 * the Gate that has waited longest first. Two Gates that opened at the
 * same moment keep one order on every screen.
 */
export function inboxOrder<G extends Ordered>(gates: readonly G[]): G[] {
	return [...gates].sort(
		(a, b) =>
			a.openedAt - b.openedAt ||
			a.runId.localeCompare(b.runId) ||
			a.stepId.localeCompare(b.stepId),
	);
}
