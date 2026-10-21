/**
 * The lease heartbeat as another process reads it (`@nightshift/daemon/heartbeat`):
 * the desktop watchdog in its Worker and `nightshift health`. This entry
 * imports nothing but Bun and Node, and does nothing when it loads. The
 * daemon writes the lease row (`runtime/lease.ts`).
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
