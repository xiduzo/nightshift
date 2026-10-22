/**
 * The phone delays a person can choose, in minutes: how long a push to a
 * phone waits while another screen is open. The Host takes 0 to 60.
 */
export const HOLD_MINUTES = [0, 1, 3, 5, 10, 15, 30, 60] as const;

/** A phone delay in words: "No delay", "1 minute", "15 minutes", "1 hour". */
export function holdLabel(minutes: number): string {
	if (minutes === 0) return "No delay";
	if (minutes === 60) return "1 hour";
	return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
