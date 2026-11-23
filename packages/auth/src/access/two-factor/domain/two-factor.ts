/**
 * A Person may add a second factor to their password (the two-factor
 * plugin, which `auth.ts` adds): a code from an authenticator app, or a
 * backup code. A Host can require it for sessions from other computers
 * (`host-access/`).
 */

/** How long a browser that a person trusts skips the second factor at sign-in. */
export const TRUSTED_BROWSER_DAYS = 30;
