/**
 * How Night Shift refuses a call that needs a person first: nobody is
 * signed in, or two-factor sign-in must be on. Each app reads
 * these to send the person to the right page.
 */

/** The oRPC code Night Shift refuses a call with when nobody is signed in. */
export const SIGN_IN_REQUIRED = "UNAUTHORIZED";

/** Whether an error is the daemon's refusal of a call without a session. */
export function isSignInRequired(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === SIGN_IN_REQUIRED
	);
}

/** The code Night Shift refuses with until two-factor is on (`@nightshift/auth/host-access`). */
export const TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED";

/** Whether an error is the daemon's refusal of a session without two-factor. */
export function isTwoFactorRequired(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === TWO_FACTOR_REQUIRED
	);
}
