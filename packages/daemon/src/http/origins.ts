/** Packaged desktop builds serve the frontend from their own origin, not CORS_ORIGIN. */
export const desktopOrigins = ["views://mainview"];

/**
 * The phone app (`apps/mobile`): its own scheme, and `exp://` for Expo Go
 * and development builds. A pattern without a host matches every address of
 * that scheme. `@better-auth/expo` sends it in the `expo-origin` header,
 * which its server plugin turns into the request's origin.
 *
 * These only let Better Auth accept the phone's sign-in. A web page never
 * has one of these origins, so they open nothing to a browser. They are not
 * in `trustedOriginsOf`: they never get the local session.
 */
export const phoneOrigins = ["nightshift://", "exp://"];

/**
 * The daemon's own addresses on this computer: the UI it serves itself
 * (the `nightshift` binary) opened here, or through an SSH tunnel.
 */
export function localOrigins(port: number): string[] {
	return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

/**
 * The origins Better Auth trusts besides CORS_ORIGIN and the Host's own
 * addresses: the desktop app, this daemon's own pages, and the phone app.
 */
export function authOriginsOf(port: number): string[] {
	return [...desktopOrigins, ...localOrigins(port), ...phoneOrigins];
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
