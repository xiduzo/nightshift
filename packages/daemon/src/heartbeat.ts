/**
 * The lease heartbeat as another process reads it: `nightshift health`.
 * The daemon writes the lease row (`runtime/lease.ts`).
 *
 * Only from another process. bun:sqlite is a second copy of SQLite beside
 * the daemon's libsql: in one process the two do not see each other's
 * locks, and closing this connection can reset the daemon's shared-memory
 * file under it (a SIGBUS in the daemon). The desktop watchdog hears the
 * heartbeat from the daemon instead (`Daemon.onLeaseHeartbeat`).
 */
import { Database as Sqlite } from "bun:sqlite";
import { existsSync } from "node:fs";

/** The lease row, as far as health needs it. Times in ms. */
export type Heartbeat = {
	/** Null once the daemon stopped and gave the lease up. */
	owner: string | null;
	host: string;
	pid: number;
	acquiredAt: number;
	heartbeatAt: number;
};

/**
 * The lease row of a database file, opened read-only: from another
 * process, without the daemon. Null when there is no file or no lease yet.
 */
export function readHeartbeatFile(path: string): Heartbeat | null {
	if (!existsSync(path)) return null;
	const sqlite = new Sqlite(path, { readonly: true });
	try {
		return sqlite
			.query<Heartbeat, []>(
				"SELECT owner, host, pid, acquired_at AS acquiredAt, heartbeat_at AS heartbeatAt FROM daemon_lease WHERE id = 1",
			)
			.get();
	} catch (error) {
		// A database the daemon has not set up yet.
		if (String(error).includes("no such table")) return null;
		throw error;
	} finally {
		sqlite.close();
	}
}
