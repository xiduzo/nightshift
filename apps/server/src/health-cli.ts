import { join } from "node:path";

import { createDb } from "@nightshift/db";
import {
	DATABASE_FILE,
	databaseUrl,
	resolveDataDir,
} from "@nightshift/db/data-dir";

import {
	type Health,
	type Heartbeat,
	leaseHealth,
	readHeartbeat,
	readHeartbeatFile,
	stopHolder,
} from "./health";

/**
 * `nightshift health`: whether Night Shift runs on this data folder. It
 * reads the database itself, so it answers when HTTP does not, and the
 * container image needs no curl. Exit code 0: it runs. 1: it does not.
 *
 * `--restart` stops a Night Shift that does not respond, so that its
 * service manager (launchd, systemd) starts it again. It checks twice,
 * 15 s apart first: a computer that just woke from sleep gets one
 * heartbeat to catch up.
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

export async function healthCommand(argv: string[], program: string) {
	const args = [...argv];
	let dataDir = process.env.NIGHTSHIFT_DATA_DIR;
	let restart = false;
	while (args.length > 0) {
		const arg = args.shift() as string;
		if (arg === "--data-dir" && args[0]) dataDir = args.shift();
		else if (arg === "--restart") restart = true;
		else {
			console.log(
				`Usage: ${program} [--data-dir <folder>] [--restart]\nExit code 0 when Night Shift runs on this data folder, else 1.\n--restart stops a Night Shift that does not respond, so that its service manager starts it again.`,
			);
			process.exit(2);
		}
	}
	const dir = resolveDataDir({
		NIGHTSHIFT_DATA_DIR: dataDir,
		NIGHTSHIFT_DEV: process.env.NIGHTSHIFT_DEV === "true",
	});
	const url = databaseUrl({ DATABASE_URL: process.env.DATABASE_URL }, dir);
	try {
		process.exit(await checkHealth({ url, restart }));
	} catch (error) {
		console.error(
			`The database in ${url.startsWith("file:") ? join(dir, DATABASE_FILE) : "DATABASE_URL"} cannot be read:`,
			error instanceof Error ? error.message : error,
		);
		process.exit(1);
	}
}
