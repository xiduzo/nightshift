/**
 * The daemon's port when PORT does not say: `bun run dev`, `nightshift
 * serve`, the desktop app and the CLI commands that call the daemon on this
 * computer. The one home of this number. The web build's VITE_SERVER_URL
 * (`apps/web/.env`) names it too.
 */
export const DEFAULT_PORT = 3000;

/**
 * The desktop app's daemon port. Not DEFAULT_PORT: the packaged app and a
 * `bun run dev` daemon run side by side and never take each other's port.
 * NIGHTSHIFT_DESKTOP_PORT moves it.
 */
export const DESKTOP_PORT = 4300;

/** PORT, else DEFAULT_PORT. Not checked: `serve` checks its own. */
export function daemonPort(
	env: Record<string, string | undefined> = process.env,
): number {
	return Number(env.PORT || DEFAULT_PORT);
}
