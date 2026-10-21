/** Whom a daemon answers: this computer only, or the network. */
export type Reach = "this-computer" | "network";

/**
 * Secure by default: a daemon listens on this computer only, until it is a
 * Host with an `https://` address. A loopback `http://` address never
 * opens it to the network.
 */
export function reachFor(settings: {
	host: boolean;
	hostAddresses: readonly string[];
}): Reach {
	return settings.host &&
		settings.hostAddresses.some((a) => a.startsWith("https://"))
		? "network"
		: "this-computer";
}

/**
 * The hostname Bun binds for a reach. This computer: the IPv4 loopback.
 * `127.0.0.1` callers reach it directly, and a `localhost` caller (curl, a
 * browser, Bun's fetch) falls back from `::1` to it. Bun's own `localhost`
 * binds `::1` only, which `127.0.0.1` callers cannot reach.
 */
export const LISTEN_HOSTNAME: Record<Reach, string> = {
	"this-computer": "127.0.0.1",
	network: "0.0.0.0",
};

/**
 * The hostname a daemon binds. Not a Host: the loopback, always. A Host:
 * the network, or `listen` (NIGHTSHIFT_LISTEN) when it is set, for a Host
 * whose way out runs on the same computer (Tailscale Serve, a tunnel, a
 * proxy): `127.0.0.1` keeps it off the LAN.
 */
export function listenHostname(reach: Reach, listen?: string | null): string {
	if (reach === "this-computer") return LISTEN_HOSTNAME[reach];
	return listen?.trim() || LISTEN_HOSTNAME.network;
}
