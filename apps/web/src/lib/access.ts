/**
 * Who may see the app in this browser. On this computer nobody signs in.
 * From another computer a person signs in first, and turns on two-factor
 * sign-in when the Host asks for it. The root route asks `accessRedirect`
 * where to send the person, and back to the page they asked for after.
 */

/** The parts of `account.status` that decide where a person may go. */
export type AccessStatus = {
	signedIn: boolean;
	thisComputer: boolean;
	twoFactor: { setUpNeeded: boolean };
};

/** Pages without the app's sidebar: signing in, an invitation's link, the two-factor setup. */
export const OUTSIDE_APP = ["/login", "/invite/", "/two-factor"];

/** Pages a session may see before it turns on the two-factor sign-in the Host requires. */
const BEFORE_TWO_FACTOR = ["/login", "/two-factor"];

/** Pages to never return to after signing in or setting up two-factor. */
const NOT_A_RETURN = ["/login", "/two-factor"];

const startsWithAny = (path: string, prefixes: readonly string[]) =>
	prefixes.some((prefix) => path.startsWith(prefix));

/** Whether `pathname` is a page without the app's sidebar. */
export function isOutsideApp(pathname: string): boolean {
	return startsWithAny(pathname, OUTSIDE_APP);
}

/**
 * Where to go after signing in or the two-factor setup: a page of this
 * app (a path with one leading slash), never another site.
 */
export function safeRedirect(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.startsWith("/")) return undefined;
	// "//host" and "/\host" lead to another site.
	if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
	if (startsWithAny(value, NOT_A_RETURN)) return undefined;
	return value;
}

/** A page to send the person to, with the page to come back to after. */
export type AccessRedirect = {
	to: "/login" | "/two-factor";
	redirect: string | undefined;
};

/**
 * Where the person must go before they see `pathname` (`href` is the page
 * with its search), or null when they may see it.
 */
export function accessRedirect(
	status: AccessStatus,
	{ pathname, href }: { pathname: string; href: string },
): AccessRedirect | null {
	const back = href === "/" ? undefined : safeRedirect(href);
	if (
		status.twoFactor.setUpNeeded &&
		!startsWithAny(pathname, BEFORE_TWO_FACTOR)
	) {
		return { to: "/two-factor", redirect: back };
	}
	if (!status.signedIn && !status.thisComputer && !isOutsideApp(pathname)) {
		return { to: "/login", redirect: back };
	}
	return null;
}

/** The oRPC code the daemon refuses a call with when nobody is signed in. */
export const SIGN_IN_REQUIRED = "UNAUTHORIZED";

/** Whether an error is the daemon's refusal of a call without a session. */
export function isSignInRequired(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === SIGN_IN_REQUIRED
	);
}
