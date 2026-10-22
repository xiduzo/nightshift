/**
 * The phone delay: how long phones and closed browsers wait while the
 * person uses Night Shift on another screen. The web and the phone offer
 * the same choices with the same words.
 */

/** The phone delays to choose from, in minutes. The Host takes 0 to 60. */
export const PHONE_DELAYS: readonly number[] = [0, 1, 3, 5, 10, 15, 30, 60];

/** The words of one phone delay. */
export function phoneDelayLabel(minutes: number): string {
	if (minutes === 0) return "No delay";
	if (minutes === 60) return "1 hour";
	return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
