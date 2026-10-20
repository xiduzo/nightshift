import { Database as Sqlite } from "bun:sqlite";
import { existsSync } from "node:fs";
import { hostname } from "node:os";

import type { Database } from "@nightshift/db";
import { daemonLease } from "@nightshift/db/schema/nightshift";
import { pidAlive } from "@nightshift/engine/lease";

/**
 * Whether the daemon is alive, from its lease heartbeat (every 10 s, from a
 * timer). A heartbeat older than three periods means the daemon hangs or
 * its timers stopped, even when HTTP still answers. `GET /health`,
 * `nightshift health` and the watchdogs all read this. Reading it needs
 * `Date.now()` and the database, never a timer, so it answers truthfully
 * when the daemon's timers are dead.
 */

/** Three missed heartbeats. */
export const HEALTH_STALE_AFTER_MS = 30_000;

/** The lease row, as far as health needs it. Times in ms. */
export type Heartbeat = {
	/** Null once the daemon stopped and gave the lease up. */
	owner: string | null;
	host: string;
	pid: number;
	acquiredAt: number;
	heartbeatAt: number;
};

export type Health = {
	healthy: boolean;
	/**
	 * running: a fresh heartbeat. stale: an old one. stopped: the lease was
	 * given up. none: no daemon ever ran on this database. other: another
	 * daemon holds the lease.
	 */
	status: "running" | "stale" | "stopped" | "none" | "other";
	/** How old the last heartbeat is, when there is one. */
	heartbeatAgeMs: number | null;
};

/** `owner`: the lease this daemon holds, to tell another daemon's apart. */
export function leaseHealth(
	heartbeat: Heartbeat | null,
	options: { now?: number; owner?: string; staleAfterMs?: number } = {},
): Health {
	if (!heartbeat)
		return { healthy: false, status: "none", heartbeatAgeMs: null };
	const heartbeatAgeMs = (options.now ?? Date.now()) - heartbeat.heartbeatAt;
	const status =
		heartbeat.owner === null
			? "stopped"
			: options.owner !== undefined && heartbeat.owner !== options.owner
				? "other"
				: heartbeatAgeMs > (options.staleAfterMs ?? HEALTH_STALE_AFTER_MS)
					? "stale"
					: "running";
	return { healthy: status === "running", status, heartbeatAgeMs };
}

/** The lease row of the daemon's own database. */
export async function readHeartbeat(db: Database): Promise<Heartbeat | null> {
	// The table has one row.
	const [row] = await db.select().from(daemonLease).limit(1);
	if (!row) return null;
	return {
		owner: row.owner,
		host: row.host,
		pid: row.pid,
		acquiredAt: row.acquiredAt.getTime(),
		heartbeatAt: row.heartbeatAt.getTime(),
	};
}

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

/** `ps`'s elapsed time (`[[dd-]hh:]mm:ss`) in seconds. */
export function elapsedSeconds(etime: string): number | null {
	const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
	if (!match) return null;
	const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
	return ((+days * 24 + +hours) * 60 + +minutes) * 60 + +seconds;
}

/** When the process with this pid started, from `ps`. Null when unknown. */
export function processStartedAt(pid: number, now = Date.now()): number | null {
	try {
		const ps = Bun.spawnSync(["ps", "-o", "etime=", "-p", String(pid)]);
		if (ps.exitCode !== 0) return null;
		const seconds = elapsedSeconds(ps.stdout.toString());
		return seconds === null ? null : now - seconds * 1_000;
	} catch {
		// No `ps` here.
		return null;
	}
}

export type StopOptions = {
	/** How long SIGTERM gets before SIGKILL. */
	graceMs?: number;
	log?: (message: string) => void;
	/** This computer's name, as the lease says it. */
	host?: string;
};

/**
 * Stops the daemon that holds a stale lease: SIGTERM, then SIGKILL. Only a
 * daemon on this computer, and only the process that took the lease: a pid
 * the system gave to another process since is left alone. The service
 * manager starts Night Shift again. True when a process was stopped.
 */
export async function stopHolder(
	holder: Heartbeat,
	options: StopOptions = {},
): Promise<boolean> {
	const log = options.log ?? console.log;
	const { pid } = holder;
	if (holder.host !== (options.host ?? hostname())) {
		log(`Night Shift runs on ${holder.host}. Restart it there.`);
		return false;
	}
	if (!pidAlive(pid)) {
		log("Night Shift has stopped already.");
		return false;
	}
	// `ps` counts in whole seconds.
	const started = processStartedAt(pid);
	if (started === null || started > holder.acquiredAt + 2_000) {
		log(`Process ${pid} is not the Night Shift that stopped. It stays.`);
		return false;
	}
	log(`Stopping Night Shift (process ${pid}), so that it starts again.`);
	process.kill(pid, "SIGTERM");
	const graceMs = options.graceMs ?? 5_000;
	for (let waited = 0; waited < graceMs && pidAlive(pid); waited += 250) {
		await Bun.sleep(250);
	}
	if (pidAlive(pid)) {
		log("Night Shift did not stop. Killing it.");
		process.kill(pid, "SIGKILL");
	}
	return true;
}
