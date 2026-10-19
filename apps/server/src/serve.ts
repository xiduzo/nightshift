import type { SocketData } from "./sync";

/**
 * How the desktop app and `nightshift serve` put the daemon on the network.
 * (`bun run dev` serves `./index`'s default export directly.)
 */

/** What `./index` gives Bun to serve. */
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
}): Listener[] {
	if (!options.tls) {
		return [{ hostname: options.hostname, port: options.port, tls: false }];
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
		fetch?: DaemonServe["fetch"];
	},
): Bun.Server<SocketData>[] {
	const fetch = options.fetch ?? daemon.fetch;
	return listeners({
		hostname: daemon.hostname,
		tls: Boolean(daemon.tls),
		port: options.port,
		tlsPort: options.tlsPort,
	}).map((listener) =>
		Bun.serve<SocketData>({
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
