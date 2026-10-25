import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

/** How long a write waits for the lock of another process (the CLI's, say). */
const BUSY_TIMEOUT_MS = 5000;

/**
 * The database client of a process. A database file gets its write
 * discipline here, so every process that opens it writes the same way:
 *
 * - A write-ahead log, synced at checkpoints only (`synchronous=NORMAL`):
 *   a write does not wait for the disk. A power loss can lose the last
 *   few writes, never the file.
 * - One connection. libsql runs each statement at once, so a second
 *   connection reads no faster, but a write on it fails while the first
 *   holds a write lock. A unit of writes is therefore one `db.batch`,
 *   never an interactive `db.transaction` that holds the connection
 *   across awaits.
 * - A wait of 5 seconds for the lock of another process.
 *
 * A file that must stay one file (a run bundle) keeps the rollback
 * journal: a write-ahead log would hold its last writes in a second file.
 * In-memory and remote databases keep the defaults of libsql.
 */
export function createDb(
	env: DatabaseConfig,
	options: { singleFile?: boolean } = {},
) {
	const file = env.DATABASE_URL.startsWith("file:");
	const client = createClient({
		url: env.DATABASE_URL,
		...(file ? { concurrency: 1, timeout: BUSY_TIMEOUT_MS } : {}),
	});
	if (file && !options.singleFile) {
		// The one connection takes these first: every later statement waits
		// for it behind them.
		client
			.executeMultiple(
				"PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
			)
			.catch((error: unknown) => {
				console.warn(
					"[db] The database keeps its old journal and sync settings:",
					error,
				);
			});
	}

	return drizzle({ client, relations });
}

export type Database = ReturnType<typeof createDb>;
