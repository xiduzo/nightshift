/**
 * The rules of the Needs-you inbox: how long it keeps what it showed, and
 * the order of its answered Gates. The order of its open Gates is the one
 * of every list of open Gates (`inboxOrder` of `read/`): the use cases get
 * it through their ports.
 */

/**
 * How long the inbox keeps what it showed: answered Gates.
 * The same 90 days as runs (`cleanUpAfterDays`).
 */
export const INBOX_KEEP_MS = 90 * 24 * 60 * 60_000;

/** Why the inbox has nothing for a caller that is not a Person. */
export const INBOX_SIGNED_OUT = "Sign in to see the Gates that wait for you.";

/** An answered Gate as the order reads it. */
type Answered = { closedAt: number; runId: string; stepId: string };

/**
 * The order of the answered Gates: the one that closed last first. Two
 * Gates that closed at the same moment keep one order on every screen.
 */
export function answeredOrder<G extends Answered>(gates: readonly G[]): G[] {
	return [...gates].sort(
		(a, b) =>
			b.closedAt - a.closedAt ||
			a.runId.localeCompare(b.runId) ||
			a.stepId.localeCompare(b.stepId),
	);
}
