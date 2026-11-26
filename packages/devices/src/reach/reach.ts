import { isIPv6 } from "node:net";
import { Refusal } from "@nightshift/refusal";

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
 * Where a Host listens, as NIGHTSHIFT_LISTEN or `--listen` says it: an IP
 * address (IPv6 with or without brackets), `localhost` or a host name.
 * Only `parseListen` makes one, so Bun never gets a value it was not
 * checked for.
 */
export type Listen = string & { readonly listen: unique symbol };

/** One label of a host name (RFC 1123): letters, digits and hyphens, no hyphen at an end. */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * A host name by its form (RFC 1123), with one optional dot at the end. It
 * need not resolve. An IPv4 address (`127.0.0.1`) has this form too.
 */
function isHostName(text: string): boolean {
	const name = text.endsWith(".") ? text.slice(0, -1) : text;
	return (
		name.length <= 253 && name.split(".").every((label) => LABEL.test(label))
	);
}

/** An IPv6 address, bracketed or not, with or without a zone (`fe80::1%lo0`). */
function isIPv6Address(text: string): boolean {
	const bare =
		text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
	return isIPv6(bare);
}

/**
 * NIGHTSHIFT_LISTEN (or `--listen`), checked before anything starts. Blank:
 * null, the default. Else the value as written, trimmed: Bun takes each
 * form. A port, a scheme, a path or a space in it is refused.
 */
export function parseListen(text: string | null | undefined): Listen | null {
	const value = text?.trim() ?? "";
	if (value === "") return null;
	if (isIPv6Address(value) || isHostName(value)) {
		return value as Listen;
	}
	throw new Refusal(
		"invalid",
		`${value} is not an address to listen on. Use an IP address or a host name, for example 127.0.0.1.`,
	);
}

/**
 * The hostname a daemon binds. Not a Host: the loopback, always. A Host:
 * the network, or `listen` (NIGHTSHIFT_LISTEN) when it is set, for a Host
 * whose way out runs on the same computer (Tailscale Serve, a tunnel, a
 * proxy): `127.0.0.1` keeps it off the LAN.
 */
export function listenHostname(reach: Reach, listen: Listen | null): string {
	if (reach === "this-computer") return LISTEN_HOSTNAME[reach];
	return listen ?? LISTEN_HOSTNAME.network;
}
