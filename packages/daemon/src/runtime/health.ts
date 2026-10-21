import { hostname } from "node:os";

import { createDb, type Database } from "@nightshift/db";
import { daemonLease } from "@nightshift/db/schema";
import { type Heartbeat, readHeartbeatFile } from "../heartbeat";
import { pidAlive } from "./lease";

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

/*
 * The check of `nightshift health`. The CLI parses its flags. With
 * `restart`, it checks twice, 15 s apart. A computer that just woke from
 * sleep gets one heartbeat to catch up.
 */

/** Longer than one heartbeat period (10 s). */
const RECHECK_MS = 15_000;

export type HealthCheck = {
	/** The database URL: a file in the data folder, or a libsql server. */
	url: string;
	restart: boolean;
	recheckMs?: number;
	graceMs?: number;
	log?: (message: string) => void;
	host?: string;
};

/** Checks, prints the result, and gives the exit code. */
export async function checkHealth(check: HealthCheck): Promise<0 | 1> {
	const log = check.log ?? console.log;
	const read = async () => {
		const heartbeat = await readLease(check.url);
		return { heartbeat, health: leaseHealth(heartbeat) };
	};
	let { heartbeat, health } = await read();
	if (check.restart && health.status === "stale") {
		await Bun.sleep(check.recheckMs ?? RECHECK_MS);
		({ heartbeat, health } = await read());
	}
	log(describe(health));
	if (health.healthy) return 0;
	if (check.restart && health.status === "stale" && heartbeat) {
		await stopHolder(heartbeat, {
			log,
			graceMs: check.graceMs,
			host: check.host,
		});
	}
	return 1;
}

async function readLease(url: string): Promise<Heartbeat | null> {
	if (url.startsWith("file:")) return readHeartbeatFile(url.slice(5));
	// A libsql server (DATABASE_URL).
	const db = createDb({ DATABASE_URL: url });
	try {
		return await readHeartbeat(db);
	} finally {
		db.$client.close();
	}
}

function describe(health: Health): string {
	const age =
		health.heartbeatAgeMs === null
			? ""
			: ` Its last sign of life was ${Math.round(health.heartbeatAgeMs / 1_000)} s ago.`;
	switch (health.status) {
		case "running":
			return `Night Shift runs.${age}`;
		case "stale":
			return `Night Shift does not respond.${age}`;
		case "stopped":
			return "Night Shift is stopped.";
		default:
			return "Night Shift has not run with this data folder yet.";
	}
}
