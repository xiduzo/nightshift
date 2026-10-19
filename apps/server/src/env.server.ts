import "varlock/auto-load";

import { ENV } from "./env";

export { ENV };

/** Packaged desktop builds serve the frontend from their own origin, not CORS_ORIGIN. */
export const desktopOrigins = ["views://mainview"];

/**
 * The daemon's own addresses on this computer: the UI it serves itself
 * (the `nightshift` binary) opened here, or through an SSH tunnel.
 */
const port = process.env.PORT || "3000";
export const localOrigins = [
	`http://localhost:${port}`,
	`http://127.0.0.1:${port}`,
];

/** Pages that may call this daemon: the web app, the desktop app, its own. */
export const trustedOrigins: ReadonlySet<string> = new Set([
	new URL(ENV.CORS_ORIGIN).origin,
	new URL(ENV.BETTER_AUTH_URL).origin,
	...desktopOrigins,
	...localOrigins,
]);
