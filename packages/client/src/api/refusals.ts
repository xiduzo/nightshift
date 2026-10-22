/**
 * How Night Shift refuses a call that needs a person first: nobody is
 * signed in, or two-factor sign-in must be on. Each app reads
 * these to send the person to the right page. And how it refuses an
 * action it cannot take to the Host of the Space now.
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

/** The code Night Shift refuses an action with while the Host that keeps its Space cannot be reached. */
export const HOST_UNREACHABLE = "HOST_UNREACHABLE";

/** Whether an error says the Host that keeps the Space cannot be reached now: the person tries again later. */
export function isHostUnreachable(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === HOST_UNREACHABLE
	);
}
