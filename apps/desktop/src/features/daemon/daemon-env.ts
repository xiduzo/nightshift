import {
	type DaemonEnv,
	prepareDaemonEnv as prepare,
} from "@nightshift/daemon";
import fixPath from "fix-path";

/**
 * Fills `process.env` for the daemon before it starts. The packaged app has
 * no `.env` files: a value set in the environment (an app started from a
 * terminal) wins, else the desktop default applies.
 *
 * - PATH: an app started from Finder or the Dock gets a short PATH. The
 *   harness CLIs (`claude`, `codex`, `gh`, …) live in the login shell's PATH.
 * - BETTER_AUTH_SECRET: made once and kept in the data directory (see
 *   `prepareDaemonEnv` in `@nightshift/daemon`, which the `nightshift`
 *   binary shares).
 */
export function prepareDaemonEnv(daemonUrl: string, port: number): DaemonEnv {
	fixPath();
	// The packaged window has its own origin (`views://mainview`, allowed by the
	// daemon). The dev window loads the web dev server.
	return prepare({ port, url: daemonUrl, uiOrigin: "http://localhost:3001" })
		.env;
}
