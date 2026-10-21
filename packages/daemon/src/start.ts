import { createDaemon, type Daemon, type DaemonOptions } from "./daemon";
import { serveDaemon } from "./http";
import { type DaemonEnv, notifySystemd } from "./runtime";
import type { SocketData } from "./sync";

export type StartOptions = DaemonOptions & {
	env: DaemonEnv;
	port: number;
	/** The https:// port with the daemon's own certificate. Default: the port + 443. */
	tlsPort?: number;
	/**
	 * One listener on `port`, with TLS when there is a certificate:
	 * `bun run dev` and `bun run night`. Else this computer keeps plain
	 * http on `127.0.0.1:port`, and other computers use https on `tlsPort`.
	 */
	oneListener?: boolean;
	/** Answers first, else the daemon does: the web UI that `nightshift serve` serves. */
	web?: (request: Request) => Promise<Response | null>;
};

export type RunningDaemon = Daemon & { servers: Bun.Server<SocketData>[] };

/**
 * The one boot sequence: `bun run dev`, `nightshift serve` and the desktop
 * app all start the daemon here. It makes the daemon, listens, and tells
 * systemd it started (nothing outside systemd). `stop` also stops the
 * listeners. Under `bun --hot` each reload calls it again: Bun reloads the
 * listeners in place, with the new daemon's handlers.
 */
export async function startDaemon(
	options: StartOptions,
): Promise<RunningDaemon> {
	const daemon = await createDaemon(options.env, {
		port: options.port,
		piAcp: options.piAcp,
		migrationsFolder: options.migrationsFolder,
	});
	const { web } = options;
	const servers = serveDaemon(daemon, {
		port: options.port,
		tlsPort: options.tlsPort,
		oneListener: options.oneListener,
		...(web
			? {
					fetch: async (request, server) =>
						(await web(request)) ?? daemon.fetch(request, server),
				}
			: {}),
	});
	for (const server of servers) {
		console.log(`Night Shift answers at ${server.url}`);
	}
	// Under systemd: started, and the watchdog's pings.
	notifySystemd();
	console.log(`Data folder: ${daemon.info.dataDir}`);
	return {
		...daemon,
		servers,
		stop: async () => {
			for (const server of servers) server.stop(true);
			await daemon.stop();
		},
	};
}
