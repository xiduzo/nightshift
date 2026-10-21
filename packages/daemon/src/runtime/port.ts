/**
 * The daemon's port when PORT does not say: `bun run dev`, `nightshift
 * serve`, the desktop app and the CLI commands that call the daemon on this
 * computer. The one home of this number. The web build's VITE_SERVER_URL
 * (`apps/web/.env`) names it too.
 */
export const DEFAULT_PORT = 3000;

/** PORT, else DEFAULT_PORT. Not checked: `serve` checks its own. */
export function daemonPort(
	env: Record<string, string | undefined> = process.env,
): number {
	return Number(env.PORT || DEFAULT_PORT);
}
