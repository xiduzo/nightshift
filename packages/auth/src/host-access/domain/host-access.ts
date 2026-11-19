/**
 * Who may use this Host: one decision for every way in (the procedures,
 * Better Auth's own endpoints, the sync socket, a run's download).
 *
 * A Host can require two-factor sign-in for people who sign in from
 * another computer (`nightshift serve --require-two-factor`). Then a
 * session from another computer whose Person has not turned two-factor on
 * may only set it up, read its session, and sign out. Everything else
 * refuses it with `TWO_FACTOR_REQUIRED`, and the web UI sends the person
 * to the setup page.
 *
 * Never affected: this computer (its local session, or a session signed in
 * on this computer itself) and Device keys. A Device is not a Person, and
 * this computer has nobody to protect it from.
 */

/** The Host's rules for sessions from other computers. */
export type HostPolicy = {
	/** People who sign in from another computer must use two-factor sign-in. */
	requireTwoFactor: boolean;
};

export const OPEN_HOST: HostPolicy = { requireTwoFactor: false };

/** The error code the procedures and endpoints refuse with. The web UI looks for it. */
export const TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED";

export const TWO_FACTOR_REQUIRED_MESSAGE =
	"This Host asks for two-factor sign-in. Turn it on for your account to continue.";

export type HostAccess =
	| { allowed: true }
	| {
			allowed: false;
			code: typeof TWO_FACTOR_REQUIRED;
			message: string;
	  };

/** What decides: the request's session, where it comes from, and whether it is a Device. */
export type HostCaller = {
	/** The request's session, if any. Only its Person's two-factor state counts. */
	session: { user: { twoFactorEnabled?: boolean | null } } | null;
	/** From this computer itself (`isThisComputer`), not through a proxy or a tunnel. */
	fromThisComputer: boolean;
	/** The request carries a Device key. */
	device?: boolean;
};

const ALLOWED: HostAccess = { allowed: true };

/** May this caller use the Host now? */
export function hostAccess(policy: HostPolicy, caller: HostCaller): HostAccess {
	if (!policy.requireTwoFactor) return ALLOWED;
	if (caller.device || caller.fromThisComputer) return ALLOWED;
	// No session: nothing to decide here. Each way in asks for a session itself.
	if (!caller.session) return ALLOWED;
	if (caller.session.user.twoFactorEnabled === true) return ALLOWED;
	return {
		allowed: false,
		code: TWO_FACTOR_REQUIRED,
		message: TWO_FACTOR_REQUIRED_MESSAGE,
	};
}

/**
 * Better Auth's endpoints (paths after `/api/auth`) a refused session may
 * still call: its session and accounts (read), signing in and out, and
 * two-factor itself.
 */
const WHILE_SETTING_UP = [
	/^\/get-session$/,
	/^\/list-accounts$/,
	/^\/sign-out$/,
	/^\/sign-in\//,
	/^\/sign-up\//,
	/^\/two-factor\//,
	/^\/ok$/,
	/^\/error$/,
];

/** May this caller call this Better Auth endpoint (a path after `/api/auth`)? */
export function authEndpointAllowed(access: HostAccess, path: string): boolean {
	if (access.allowed) return true;
	const clean = path.split("?")[0]?.replace(/\/+$/, "") ?? "";
	return WHILE_SETTING_UP.some((pattern) => pattern.test(clean));
}

/**
 * The Host's policy from its environment: NIGHTSHIFT_REQUIRE_TWO_FACTOR
 * (`nightshift serve --require-two-factor`). Throws on a value that is
 * neither on nor off, so a typo never leaves a Host open.
 */
export function hostPolicyFromEnv(env: {
	NIGHTSHIFT_REQUIRE_TWO_FACTOR?: string;
}): HostPolicy {
	const raw = env.NIGHTSHIFT_REQUIRE_TWO_FACTOR?.trim().toLowerCase() ?? "";
	if (["on", "true", "1", "yes"].includes(raw)) {
		return { requireTwoFactor: true };
	}
	if (["", "off", "false", "0", "no"].includes(raw)) return OPEN_HOST;
	throw new Error(
		`NIGHTSHIFT_REQUIRE_TWO_FACTOR is "${env.NIGHTSHIFT_REQUIRE_TWO_FACTOR}". Use on or off.`,
	);
}
