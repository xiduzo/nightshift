import type { SocketData } from "../sync";

/** How `startDaemon` puts the daemon on the network. */

/** What the daemon gives Bun to serve (`createHttp`). */
export type DaemonServe = {
	hostname: string;
	tls?: { cert: string; key: string };
	/** Undefined: the request became the relay's WebSocket. */
	fetch(
		request: Request,
		server: Bun.Server<SocketData>,
	): Response | undefined | Promise<Response | undefined>;
	websocket: Bun.WebSocketHandler<SocketData>;
};

export type Listener = { hostname: string; port: number; tls: boolean };

/**
 * Where the daemon listens. Without a certificate of its own: plain http
 * on `port`, at the hostname of its reach. With one: this computer keeps
 * plain http on `127.0.0.1:port` (its window, the CLI, a dev UI), and
 * https is on `tlsPort` at the hostname of its reach, for other computers.
 */
export function listeners(options: {
	hostname: string;
	tls: boolean;
	port: number;
	tlsPort?: number;
	/**
	 * One listener on `port`, with TLS when there is a certificate:
	 * `bun run dev` and `bun run night` (its watchdog asks
	 * https://127.0.0.1:PORT then).
	 */
	oneListener?: boolean;
}): Listener[] {
	if (!options.tls || options.oneListener) {
		return [
			{ hostname: options.hostname, port: options.port, tls: options.tls },
		];
	}
	return [
		{ hostname: "127.0.0.1", port: options.port, tls: false },
		{
			hostname: options.hostname,
			port: options.tlsPort ?? options.port + 443,
			tls: true,
		},
	];
}

/**
 * How long, in seconds, one request may wait for its answer. Bun's own
 * default is 10 s: it closed a run start that waited longer for a Device
 * to copy its project. Longer than the longest start (`START_DEADLINE_MS`
 * plus the caller's margin), so the calls' own deadlines answer first.
 */
const REQUEST_TIMEOUT_S = 5 * 60;

/**
 * The daemon cannot listen on `port`: another program uses it. Bun says
 * EADDRINUSE for every failed listen, so an address that is not this
 * computer's gets this error too.
 */
export class PortTakenError extends Error {
	readonly port: number;

	constructor(port: number, options?: { cause?: unknown }) {
		super(
			`Night Shift cannot listen on port ${port}: another program uses it. Stop that program or start Night Shift with another port.`,
			options,
		);
		this.name = "PortTakenError";
		this.port = port;
	}
}

/**
 * Starts the daemon's listeners. `fetch` wraps the daemon's own (the web
 * UI of the binary). When one does not start, it stops the ones that
 * started, and throws: a `PortTakenError` when the port is taken.
 */
export function serveDaemon(
	daemon: DaemonServe,
	options: {
		port: number;
		tlsPort?: number;
		oneListener?: boolean;
		fetch?: DaemonServe["fetch"];
	},
): Bun.Server<SocketData>[] {
	const fetch = options.fetch ?? daemon.fetch;
	const servers: Bun.Server<SocketData>[] = [];
	for (const listener of listeners({
		hostname: daemon.hostname,
		tls: Boolean(daemon.tls),
		port: options.port,
		tlsPort: options.tlsPort,
		oneListener: options.oneListener,
	})) {
		try {
			servers.push(
				Bun.serve<SocketData>({
					// Under `bun --hot`, Bun reloads the server of the same id in place:
					// the listener stays, and the new handlers answer.
					id: `nightshift:${listener.port}`,
					hostname: listener.hostname,
					port: listener.port,
					...(listener.tls && daemon.tls ? { tls: daemon.tls } : {}),
					fetch(request, server) {
						server.timeout(request, REQUEST_TIMEOUT_S);
						return fetch(request, server);
					},
					websocket: daemon.websocket,
				}),
			);
		} catch (error) {
			for (const server of servers) server.stop(true);
			// Another error (a certificate Bun refuses) stays as it is.
			if ((error as { code?: unknown }).code !== "EADDRINUSE") throw error;
			throw new PortTakenError(listener.port, { cause: error });
		}
	}
	return servers;
}

/** NIGHTSHIFT_TLS_PORT as a port, or undefined for the default. */
export function tlsPortOf(value: string | undefined): number | undefined {
	const port = Number(value);
	return value && Number.isInteger(port) && port > 0 ? port : undefined;
}
