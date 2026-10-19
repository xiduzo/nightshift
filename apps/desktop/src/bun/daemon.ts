import { prepareDaemonEnv } from "./daemon-env";

/**
 * The web build calls the daemon at VITE_SERVER_URL, which `apps/web/.env`
 * sets to this address at build time. PORT (as for `bun run night`) moves the
 * daemon: build the web app with a matching VITE_SERVER_URL.
 */
export const DAEMON_PORT = Number(process.env.PORT || 3000);
export const DAEMON_URL = `http://localhost:${DAEMON_PORT}`;

export type Daemon = {
	/** "own": this app runs the daemon. "shared": another one (`bun run night`) already did. */
	kind: "own" | "shared";
	/** Stops serving and gives the database lease up, so the next daemon starts at once. */
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
 */
export async function startDaemon(): Promise<Daemon> {
	const found = await probe();
	if (found === "nightshift") {
		console.log(`Using the Night Shift daemon at ${DAEMON_URL}.`);
		return { kind: "shared", stop: async () => {} };
	}
	if (found === "other") throw new PortTakenError();

	prepareDaemonEnv(DAEMON_URL, DAEMON_PORT);
	// Imported only now: the server reads its env and takes the database lease
	// when it loads.
	const [{ default: app }, { lease }] = await Promise.all([
		import("server/src/index"),
		import("server/src/services"),
	]);

	const server = Bun.serve({
		hostname: "localhost",
		port: DAEMON_PORT,
		fetch: app.fetch,
	});
	console.log(`Night Shift daemon on ${server.url}`);

	let stopped: Promise<void> | undefined;
	return {
		kind: "own",
		stop: () => {
			stopped ??= (async () => {
				server.stop(true);
				await Promise.race([lease.release(), Bun.sleep(2_000)]).catch(() => {});
			})();
			return stopped;
		},
	};
}
