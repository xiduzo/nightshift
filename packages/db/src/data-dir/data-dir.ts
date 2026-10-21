import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where a daemon keeps what happened on this computer: the database, the
 * transcripts and the command logs, together in one data directory. A
 * project's `.nightshift/` folder holds only what is committed (flows and
 * schedules), never run history.
 *
 * - `NIGHTSHIFT_DATA_DIR` wins. `~/` is expanded; a relative path resolves
 *   against the working directory.
 * - `NIGHTSHIFT_DEV=true` (set by `bun run dev`): `.nightshift-dev/` in this
 *   checkout, so a dev daemon never shares a database with the night daemon
 *   and each checkout has its own.
 * - Else the OS's app data directory (`appDataDir`).
 */

export const DATABASE_FILE = "nightshift.db";

/** The checkout of Night Shift this module runs from. Only dev mode uses it. */
export const checkoutRoot = fileURLToPath(
	new URL("../../../../", import.meta.url),
);

export type DataDirSystem = {
	platform: NodeJS.Platform;
	home: string;
	env: Record<string, string | undefined>;
};

const currentSystem = (): DataDirSystem => ({
	platform: process.platform,
	home: homedir(),
	env: process.env,
});

/** The per-user app data directory of the OS. */
export function appDataDir(system: DataDirSystem = currentSystem()): string {
	const { platform, home, env } = system;
	if (platform === "darwin") {
		return join(home, "Library", "Application Support", "Night Shift");
	}
	if (platform === "win32") {
		return join(env.APPDATA || join(home, "AppData", "Roaming"), "Night Shift");
	}
	return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "nightshift");
}

export type DataDirConfig = {
	NIGHTSHIFT_DATA_DIR?: string;
	NIGHTSHIFT_DEV?: boolean;
};

export function resolveDataDir(
	config: DataDirConfig,
	system: DataDirSystem = currentSystem(),
	root = checkoutRoot,
): string {
	const dir = config.NIGHTSHIFT_DATA_DIR?.trim();
	if (dir) {
		return resolve(
			dir.startsWith("~/") ? join(system.home, dir.slice(2)) : dir,
		);
	}
	if (config.NIGHTSHIFT_DEV) return join(root, ".nightshift-dev");
	return appDataDir(system);
}

/** `DATABASE_URL` when it is set (a remote libsql server, say), else the data directory's file. */
export function databaseUrl(
	config: { DATABASE_URL?: string },
	dataDir: string,
): string {
	return config.DATABASE_URL?.trim() || `file:${join(dataDir, DATABASE_FILE)}`;
}

/** Creates the data directory when it is missing. */
export function ensureDataDir(dataDir: string): string {
	mkdirSync(dataDir, { recursive: true });
	return dataDir;
}

const hasEntries = (dir: string) =>
	existsSync(dir) && readdirSync(dir).length > 0;

/**
 * Run history in the places that came before the data directory: the
 * checkout's `local.db` and `~/.nightshift/{transcripts,logs}`. Listed only
 * when the data directory does not have its own yet, so a person who moved
 * the data sees nothing.
 */
export function legacyData(input: {
	dataDir: string;
	/** Whether `DATABASE_URL` is set: then the database is where it says. */
	databaseUrlSet: boolean;
	home?: string;
	root?: string;
}): { database: string | null; files: string[] } {
	const home = input.home ?? homedir();
	const root = input.root ?? checkoutRoot;
	const oldDb = join(root, "local.db");
	const database =
		!input.databaseUrlSet &&
		existsSync(oldDb) &&
		!existsSync(join(input.dataDir, DATABASE_FILE))
			? oldDb
			: null;
	const oldDir = join(home, ".nightshift");
	const files =
		resolve(oldDir) === resolve(input.dataDir)
			? []
			: ["transcripts", "logs"]
					.map((name) => ({
						from: join(oldDir, name),
						to: join(input.dataDir, name),
					}))
					.filter(({ from, to }) => hasEntries(from) && !hasEntries(to))
					.map(({ from }) => from);
	return { database, files };
}
