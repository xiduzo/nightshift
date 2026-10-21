/** Packaged desktop builds serve the frontend from their own origin, not CORS_ORIGIN. */
export const desktopOrigins = ["views://mainview"];

/**
 * The daemon's own addresses on this computer: the UI it serves itself
 * (the `nightshift` binary) opened here, or through an SSH tunnel.
 */
export function localOrigins(port: number): string[] {
	return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

/** Pages that may call this daemon: the web app, the desktop app, its own. */
export function trustedOriginsOf(
	env: { CORS_ORIGIN: string; BETTER_AUTH_URL: string },
	port: number,
): ReadonlySet<string> {
	return new Set([
		new URL(env.CORS_ORIGIN).origin,
		new URL(env.BETTER_AUTH_URL).origin,
		...desktopOrigins,
		...localOrigins(port),
	]);
}
