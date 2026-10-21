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

/** Starts the daemon's listeners. `fetch` wraps the daemon's own (the web UI of the binary). */
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
	return listeners({
		hostname: daemon.hostname,
		tls: Boolean(daemon.tls),
		port: options.port,
		tlsPort: options.tlsPort,
		oneListener: options.oneListener,
	}).map((listener) =>
		Bun.serve<SocketData>({
			// Under `bun --hot`, Bun reloads the server of the same id in place:
			// the listener stays, and the new handlers answer.
			id: `nightshift:${listener.port}`,
			hostname: listener.hostname,
			port: listener.port,
			...(listener.tls && daemon.tls ? { tls: daemon.tls } : {}),
			fetch,
			websocket: daemon.websocket,
		}),
	);
}

/** NIGHTSHIFT_TLS_PORT as a port, or undefined for the default. */
export function tlsPortOf(value: string | undefined): number | undefined {
	const port = Number(value);
	return value && Number.isInteger(port) && port > 0 ? port : undefined;
}
