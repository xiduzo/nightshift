import { twoFactor } from "better-auth/plugins/two-factor";

/**
 * A Person may add a second factor to their password (the two-factor
 * plugin): a code from an authenticator app, or a backup code. A Host can
 * require it for sessions from other computers (`host-access/`).
 */

/** How long a browser that a person trusts skips the second factor at sign-in. */
export const TRUSTED_BROWSER_DAYS = 30;

/** The two-factor plugin, as `createAuth` adds it. */
export function twoFactorPlugin() {
	return twoFactor({
		issuer: "Night Shift",
		trustDeviceMaxAge: TRUSTED_BROWSER_DAYS * 24 * 3600,
	});
}
