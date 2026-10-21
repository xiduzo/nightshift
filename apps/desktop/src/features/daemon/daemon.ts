import {
	startDaemon as bootDaemon,
	DEFAULT_PORT,
	type DesktopScreen,
	tlsPortOf,
} from "@nightshift/daemon";

import { startWatchdog } from "../watchdog";
import { prepareDaemonEnv } from "./daemon-env";

/**
 * The web build calls the daemon at VITE_SERVER_URL, which `apps/web/.env`
 * sets to this address at build time. PORT (as for `bun run night`) moves the
 * daemon: build the web app with a matching VITE_SERVER_URL.
 */
export const DAEMON_PORT = Number(process.env.PORT || DEFAULT_PORT);
export const DAEMON_URL = `http://localhost:${DAEMON_PORT}`;

export type Daemon = {
	/** "own": this app runs the daemon. "shared": another one (`bun run night`) already did. */
	kind: "own" | "shared";
	/** Stops serving, writes the Device document, and gives the database lease up, so the next daemon starts at once. */
	stop(): Promise<void>;
};

export class PortTakenError extends Error {
	constructor() {
		super(`Another program uses port ${DAEMON_PORT}.`);
		this.name = "PortTakenError";
	}
}

/** What answers on the daemon port: Night Shift, another program, or nothing. */
async function probe(): Promise<"nightshift" | "other" | "free"> {
	try {
		const response = await fetch(`${DAEMON_URL}/`, {
			signal: AbortSignal.timeout(1_500),
		});
		return (await response.text()) === "OK" ? "nightshift" : "other";
	} catch {
		return "free";
	}
}

/**
 * Runs the daemon in this process (PLAN §2, Shell): Bun is the main process,
 * so there is no sidecar. When a daemon already answers on the port, the app
 * opens a window on it instead: one database has one daemon.
 *
 * `desktop`: the app's own notifications and its window. Only a daemon of
 * this app shows them; a shared one shows its own (the OS programs).
 */
export async function startDaemon(desktop: DesktopScreen): Promise<Daemon> {
	const found = await probe();
	if (found === "nightshift") {
		console.log(`Using the Night Shift daemon at ${DAEMON_URL}.`);
		return { kind: "shared", stop: async () => {} };
	}
	if (found === "other") throw new PortTakenError();

	// This computer only, until it is a Host with an https:// address. With
	// its own certificate it also serves https:// for other computers, on
	// NIGHTSHIFT_TLS_PORT; this window keeps plain http on this computer.
	const daemon = await bootDaemon({
		env: prepareDaemonEnv(DAEMON_URL, DAEMON_PORT),
		port: DAEMON_PORT,
		tlsPort: tlsPortOf(process.env.NIGHTSHIFT_TLS_PORT),
		desktop,
	});

	// Only for the daemon this app runs: a shared one has its own watchers.
	const url = daemon.info.databaseUrl;
	const watchdog = url.startsWith("file:")
		? startWatchdog({ database: url.slice(5), owner: daemon.info.leaseOwner })
		: null;

	let stopped: Promise<void> | undefined;
	return {
		kind: "own",
		stop: () => {
			stopped ??= (async () => {
				watchdog?.terminate();
				await daemon.stop();
			})();
			return stopped;
		},
	};
}
