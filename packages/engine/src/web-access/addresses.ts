import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/**
 * Where a web request may go (a Web request node, a Wait for a URL). The
 * rules are about the addresses a host name resolves to, not about the
 * name: every address of every hop is checked before Night Shift connects.
 *
 * - Never: link-local (the cloud metadata service lives there), the
 *   unspecified and broadcast addresses, multicast, reserved ranges, and
 *   the metadata addresses of the clouds that are not link-local. An IPv6
 *   address that carries an IPv4 one (mapped, NAT64) is read as that IPv4
 *   address. 6to4 and Teredo addresses are never reached.
 * - Only with `privateNetwork`: loopback, private (RFC 1918), unique local
 *   (IPv6) and carrier-grade NAT addresses. A laptop reaches them: its
 *   person's own network. A Host reaches them only when its Settings say
 *   so: it serves every Member of its Spaces.
 *
 * DNS rebinding stays a risk: the name is resolved again when the request
 * connects, so a name that answers with another address the second time
 * gets past the check. The documented residual risk (SECURITY.md).
 */

/** The ranges no request reaches, by `ipaddr.js` range name. */
const NEVER = new Set([
	"unspecified",
	"broadcast",
	"multicast",
	"linkLocal",
	"reserved",
	"discard",
	"rfc6145",
	"6to4",
	"teredo",
]);

/** The ranges only `privateNetwork` reaches. */
const PRIVATE = new Set([
	"loopback",
	"private",
	"uniqueLocal",
	"carrierGradeNat",
]);

/** Metadata services outside link-local: AWS over IPv6, Alibaba Cloud. */
const METADATA = new Set(["fd00:ec2::254", "100.100.100.200"]);

export type AddressRules = {
	/** Loopback, private, unique local and carrier-grade NAT addresses may be reached. */
	privateNetwork: boolean;
	/** The addresses of a host name. Default: the system's resolver, every address. */
	resolve?: (hostname: string) => Promise<string[]>;
};

/** Why a request may not reach `address` (an IP address), or null when it may. */
export function addressProblem(
	address: string,
	rules: Pick<AddressRules, "privateNetwork">,
): "never" | "private" | null {
	if (!ipaddr.isValid(address)) return "never";
	let ip = ipaddr.parse(address);
	if (METADATA.has(ip.toNormalizedString()) || METADATA.has(ip.toString())) {
		return "never";
	}
	if (ip.kind() === "ipv6") {
		const v6 = ip as ipaddr.IPv6;
		if (v6.isIPv4MappedAddress()) ip = v6.toIPv4Address();
		else if (v6.range() === "rfc6052") {
			const bytes = v6.toByteArray().slice(12);
			ip = new ipaddr.IPv4(bytes);
		}
		if (METADATA.has(ip.toString())) return "never";
	}
	const range = ip.range();
	if (NEVER.has(range)) return "never";
	if (PRIVATE.has(range)) return rules.privateNetwork ? null : "private";
	return null;
}

/** The host of a URL as an address or a name: `[::1]` is `::1`. */
function bareHost(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]")
		? hostname.slice(1, -1)
		: hostname;
}

async function systemResolve(hostname: string): Promise<string[]> {
	const found = await lookup(hostname, { all: true, verbatim: true });
	return found.map((entry) => entry.address);
}

/**
 * What the check of one URL found: `ok`, or why the request may not go
 * there (`never`, `private`), or that the name did not resolve (a network
 * failure: the step tries again later).
 */
export type HostCheck =
	| { kind: "ok" }
	| { kind: "blocked"; why: "never" | "private" }
	| { kind: "unresolved"; message: string };

/** Checks every address the URL's host resolves to. */
export async function checkHost(
	url: URL,
	rules: AddressRules,
): Promise<HostCheck> {
	const host = bareHost(url.hostname);
	let addresses: string[];
	if (ipaddr.isValid(host)) addresses = [host];
	else {
		try {
			addresses = await (rules.resolve ?? systemResolve)(host);
		} catch (error) {
			return {
				kind: "unresolved",
				message: error instanceof Error ? error.message : String(error),
			};
		}
		if (addresses.length === 0) {
			return { kind: "unresolved", message: "the name has no address" };
		}
	}
	for (const address of addresses) {
		const why = addressProblem(address, rules);
		if (why !== null) return { kind: "blocked", why };
	}
	return { kind: "ok" };
}
