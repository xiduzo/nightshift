import { z } from "zod";
import { isLoopbackHost } from "../../../contract";

/**
 * A Host's address: an `https://` origin. A loopback `http://` one is
 * allowed too, for tests and local development: it never leaves the
 * computer.
 */
export const hostAddressSchema = z
	.string()
	.trim()
	.refine(isHostAddress, {
		message: "Use an https:// address, for example https://studio.example.com.",
	})
	.transform((value) => new URL(value).origin);

export function isHostAddress(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol === "https:") return true;
	return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

/** An `http://` or `https://` address. */
export function isHttpAddress(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Whether a web request from this computer may reach loopback and its
 * private network (`web-access/addresses.ts`): always on a computer that
 * is not a Host, else only when "Web requests reach this network" is on.
 * A Host serves every Member of its Spaces.
 */
export function reachesPrivateNetwork(settings: {
	host: boolean;
	webRequestsPrivateNetwork: boolean;
}): boolean {
	return !settings.host || settings.webRequestsPrivateNetwork;
}
