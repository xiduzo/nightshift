import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AuthConfig } from "@nightshift/auth";
import { ensureDataDir, resolveDataDir } from "@nightshift/db/data-dir";

/**
 * The environment the daemon reads: `apps/server/.env.schema` documents
 * every value. `bun run dev` gives varlock's ENV. `nightshift serve` and
 * the desktop app give `process.env`, after `prepareDaemonEnv`.
 */
export type DaemonEnv = Omit<AuthConfig, "BETTER_AUTH_SECRET"> & {
	/**
	 * Required in production. Without it a dev daemon uses the dev default:
	 * see `daemonAuthSecret`.
	 */
	readonly BETTER_AUTH_SECRET?: string;
	readonly NODE_ENV?: string;
	readonly DATABASE_URL?: string;
	readonly NIGHTSHIFT_DATA_DIR?: string;
	readonly NIGHTSHIFT_DEV?: string;
	readonly NIGHTSHIFT_SCHEDULER?: string;
	readonly NIGHTSHIFT_KEY_STORE?: string;
	readonly NIGHTSHIFT_LISTEN?: string;
	readonly NIGHTSHIFT_TLS_CERT?: string;
	readonly NIGHTSHIFT_TLS_KEY?: string;
	readonly NIGHTSHIFT_REQUIRE_TWO_FACTOR?: string;
	/** "off": no desktop notification, also where `desktop: "system"` asks for one. */
	readonly NIGHTSHIFT_DESKTOP_NOTIFICATIONS?: string;
	/** The Expo access token for pushes to the phone app. Optional. */
	readonly EXPO_ACCESS_TOKEN?: string;
	/** The other values are fallbacks of the settings (NIGHTSHIFT_CLAUDE_BIN, …). */
	readonly [name: string]: string | undefined;
};

/**
 * `process.env` for a daemon that runs without the varlock CLI and without
 * `.env` files: the desktop app and the `nightshift` binary. Call it before
 * the daemon starts. A value already in the environment always wins.
 */

type Env = Record<string, string | undefined>;

/** Where the auth secret is kept when nothing else gives one, next to the database. */
export const AUTH_SECRET_FILE = "auth-secret";

export function prepareDaemonEnv(options: {
	port: number;
	/** This daemon's own address: the default of BETTER_AUTH_URL. */
	url: string;
	/** The UI's address: the default of CORS_ORIGIN. */
	uiOrigin: string;
	env?: Env;
}): { dataDir: string; env: DaemonEnv } {
	const env = options.env ?? process.env;
	env.NODE_ENV ??= "production";
	env.PORT = String(options.port);
	env.BETTER_AUTH_URL ??= options.url;
	env.CORS_ORIGIN ??= options.uiOrigin;

	const dataDir = ensureDataDir(
		resolveDataDir({
			NIGHTSHIFT_DATA_DIR: env.NIGHTSHIFT_DATA_DIR,
			NIGHTSHIFT_DEV: env.NIGHTSHIFT_DEV === "true",
		}),
	);
	env.BETTER_AUTH_SECRET ??= authSecret(env, dataDir);
	// Set above: the auth values are all there now.
	return { dataDir, env: env as DaemonEnv };
}

/**
 * The auth secret, when BETTER_AUTH_SECRET is not set: the file that
 * BETTER_AUTH_SECRET_FILE names (as Docker secrets give it), else the
 * service manager's credential (systemd `LoadCredential=BETTER_AUTH_SECRET`),
 * else one made once and kept in the data directory, readable by this user
 * only.
 */
export function authSecret(env: Env, dataDir: string): string {
	const given = [
		env.BETTER_AUTH_SECRET_FILE,
		secretsDir(env) && join(secretsDir(env) as string, "BETTER_AUTH_SECRET"),
	];
	for (const file of given) {
		if (!file || !existsSync(file)) continue;
		const value = readFileSync(file, "utf8").trim();
		if (value.length < 32) {
			throw new Error(
				`The auth secret in ${file} is too short. Use at least 32 characters.`,
			);
		}
		return value;
	}
	const file = join(dataDir, AUTH_SECRET_FILE);
	if (existsSync(file)) {
		const saved = readFileSync(file, "utf8").trim();
		if (saved.length >= 32) return saved;
	}
	const secret = randomBytes(32).toString("hex");
	writeFileSync(file, secret, { mode: 0o600 });
	return secret;
}

/**
 * The auth secret this daemon signs sessions with. BETTER_AUTH_SECRET when
 * it is set. Without it, production refuses to start. Any other NODE_ENV
 * uses the dev default: `authSecret`, made once in the data directory, so a
 * new clone runs `bun run dev` without a `.env`. One log line says so.
 * `nightshift serve` and the desktop app never get here without a secret:
 * `prepareDaemonEnv` sets one first.
 */
export function daemonAuthSecret(
	env: Env,
	dataDir: string,
	log: (line: string) => void = console.warn,
): string {
	const set = env.BETTER_AUTH_SECRET?.trim();
	if (set) return set;
	if (env.NODE_ENV === "production") {
		throw new Error(
			"BETTER_AUTH_SECRET is not set. Night Shift needs a secret of at least 32 characters in production.",
		);
	}
	const secret = authSecret(env, dataDir);
	log(
		`BETTER_AUTH_SECRET is not set: this ${env.NODE_ENV ?? "development"} daemon uses the dev default in ${join(dataDir, AUTH_SECRET_FILE)}. Set BETTER_AUTH_SECRET in production.`,
	);
	return secret;
}

/**
 * The folder of secret files a service manager gives this daemon:
 * NIGHTSHIFT_SECRETS_DIR (for example /run/secrets in Docker), else
 * systemd's credentials folder (`CREDENTIALS_DIRECTORY`).
 */
export function secretsDir(env: Env = process.env): string | null {
	return (
		env.NIGHTSHIFT_SECRETS_DIR?.trim() || env.CREDENTIALS_DIRECTORY || null
	);
}

/**
 * The secrets in that folder, one file per secret, named as the secret:
 * `${NAME}` reads them like the environment. A headless computer has no
 * keychain. A file whose name is no variable name is skipped.
 */
export function secretFiles(dir: string | null): Record<string, string> {
	if (!dir || !existsSync(dir)) return {};
	const out: Record<string, string> = {};
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name)) continue;
		// systemd links credentials; Docker mounts them as files.
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		try {
			out[entry.name] = readFileSync(join(dir, entry.name), "utf8").replace(
				/\r?\n$/,
				"",
			);
		} catch {
			// A file this user cannot read is not a secret for this daemon.
		}
	}
	return out;
}

/** Who Web Push messages come from when this daemon has no public address. */
const WEB_PUSH_FALLBACK_SUBJECT = "https://github.com/xiduzo/nightshift";

/**
 * The VAPID subject of this daemon's Web Push messages: a push service may
 * contact it. The daemon's public `https:` address (a Host), else the web
 * app's, else the project's page. A local address is never one: Apple's
 * push service refuses it.
 */
export function webPushSubject(env: DaemonEnv): string {
	for (const value of [env.BETTER_AUTH_URL, env.CORS_ORIGIN]) {
		if (!value) continue;
		try {
			const url = new URL(value);
			const local =
				url.hostname === "localhost" ||
				url.hostname.endsWith(".localhost") ||
				url.hostname.endsWith(".local") ||
				/^(127\.|10\.|192\.168\.|\[::1\])/.test(url.hostname);
			if (url.protocol === "https:" && !local) return url.origin;
		} catch {
			// Not a URL: try the next one.
		}
	}
	return WEB_PUSH_FALLBACK_SUBJECT;
}
