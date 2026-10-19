import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureDataDir, resolveDataDir } from "@nightshift/db/data-dir";
import fixPath from "fix-path";

/** Where the auth secret of the desktop daemon lives, next to its database. */
const AUTH_SECRET_FILE = "auth-secret";

/**
 * Fills `process.env` for the daemon before the server loads. The packaged
 * app has no `.env` files: a value set in the environment (an app started
 * from a terminal) wins, else the desktop default applies.
 *
 * - PATH: an app started from Finder or the Dock gets a short PATH. The
 *   harness CLIs (`claude`, `codex`, `gh`, …) live in the login shell's PATH.
 * - BETTER_AUTH_SECRET: made once and kept in the data directory.
 */
export function prepareDaemonEnv(daemonUrl: string, port: number): void {
	fixPath();

	const env = process.env;
	env.NODE_ENV ??= "production";
	env.PORT = String(port);
	env.BETTER_AUTH_URL ??= daemonUrl;
	// The packaged window has its own origin (`views://mainview`, allowed by the
	// server). The dev window loads the web dev server.
	env.CORS_ORIGIN ??= "http://localhost:3001";

	const dataDir = ensureDataDir(
		resolveDataDir({
			NIGHTSHIFT_DATA_DIR: env.NIGHTSHIFT_DATA_DIR,
			NIGHTSHIFT_DEV: env.NIGHTSHIFT_DEV === "true",
		}),
	);
	env.BETTER_AUTH_SECRET ??= authSecret(dataDir);
}

function authSecret(dataDir: string): string {
	const file = join(dataDir, AUTH_SECRET_FILE);
	if (existsSync(file)) {
		const saved = readFileSync(file, "utf8").trim();
		if (saved.length >= 32) return saved;
	}
	const secret = randomBytes(32).toString("hex");
	writeFileSync(file, secret, { mode: 0o600 });
	return secret;
}
