/**
 * How Night Shift refuses a call that needs a person first: nobody is
 * signed in, or two-factor sign-in must be on. Each app reads
 * these to send the person to the right page. And how it refuses an
 * action it cannot take to the Host of the Space now, and how a Host of
 * an older version answers a procedure it does not have yet.
 */

import { ORPCError } from "@orpc/client";

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

/**
 * Whether the Host does not have the procedure at all: a Night Shift of
 * an older version, which a redeploy brings up to date. It answers a
 * plain 404 that is not an oRPC error, and the client keeps that raw
 * response as `data`. A procedure that refuses with NOT_FOUND itself
 * ("This learning no longer waits") sends an oRPC error without it.
 */
export function isMissingOnHost(error: unknown): boolean {
	if (!(error instanceof ORPCError)) return false;
	if (error.defined || error.status !== 404) return false;
	const data: unknown = error.data;
	return (
		typeof data === "object" &&
		data !== null &&
		(data as { status?: unknown }).status === 404
	);
}
