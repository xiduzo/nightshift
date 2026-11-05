import { isLoopbackHost } from "@nightshift/engine/device-config";

/**
 * A development install stays out of the Spaces of real work (ADR 20): it
 * pairs and connects only with a Host on this computer, unless the person
 * allows more with NIGHTSHIFT_DEV_LINK_HOST=true.
 */

/** What a development install says when it stays off a Host. */
export const DEV_STAYS_LOCAL =
	"A development install connects only to a Host on this computer. To connect to this Host, set NIGHTSHIFT_DEV_LINK_HOST=true.";

/** Whether this address is on this computer. An address that is not valid is not. */
export function isLocalAddress(address: string): boolean {
	try {
		return isLoopbackHost(new URL(address).hostname);
	} catch {
		return false;
	}
}

/** Whether a Host answers only on this computer: every address is local. */
export function isLocalHost(addresses: readonly string[]): boolean {
	return addresses.length > 0 && addresses.every(isLocalAddress);
}
