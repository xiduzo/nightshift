import fixPath from "fix-path";
import { prepareDaemonEnv as prepare } from "server/daemon-env";

/**
 * Fills `process.env` for the daemon before the server loads. The packaged
 * app has no `.env` files: a value set in the environment (an app started
 * from a terminal) wins, else the desktop default applies.
 *
 * - PATH: an app started from Finder or the Dock gets a short PATH. The
 *   harness CLIs (`claude`, `codex`, `gh`, …) live in the login shell's PATH.
 * - BETTER_AUTH_SECRET: made once and kept in the data directory (see
 *   `server/src/daemon-env.ts`, which the `nightshift` binary shares).
 */
export function prepareDaemonEnv(daemonUrl: string, port: number): void {
	fixPath();
	// The packaged window has its own origin (`views://mainview`, allowed by the
	// server). The dev window loads the web dev server.
	prepare({ port, url: daemonUrl, uiOrigin: "http://localhost:3001" });
}
