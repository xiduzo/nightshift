import type { Devices, DevicesOverview } from "@nightshift/api/context";
import type {
	DeviceKeyStore,
	HostLinks,
	SettingsStore,
} from "@nightshift/engine";

import type { Host } from "./host";
import { joinHost } from "./join";
import type { DeviceLinks } from "./links";

export { createHost, type Host, NOT_A_HOST } from "./host";
export { joinHost } from "./join";
export { createDeviceLinks, type DeviceLinks } from "./links";

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

/** The hostname Bun binds for a reach. */
export const LISTEN_HOSTNAME: Record<Reach, string> = {
	"this-computer": "localhost",
	network: "0.0.0.0",
};

/** The API's `Devices`: this computer as a Host, and its own links to Hosts. */
export function createDevices(deps: {
	host: Host;
	links: DeviceLinks;
	hostLinks: HostLinks;
	keys: DeviceKeyStore;
	settings: SettingsStore;
	self: { id: string; name: string; platform: string };
	/** Whom this daemon answers since it started. */
	reach: Reach;
	/** The SHA-256 fingerprint of the certificate this daemon serves itself. */
	fingerprint: string | null;
}): Devices {
	const { host } = deps;
	return {
		async overview({ personId, owner }): Promise<DevicesOverview> {
			const settings = deps.settings.current();
			return {
				thisComputer: owner
					? {
							...deps.self,
							keyStore: deps.keys.kind,
							host: {
								enabled: settings.host,
								addresses: settings.hostAddresses,
								reachable: deps.reach,
								restartNeeded: reachFor(settings) !== deps.reach,
								fingerprint: deps.fingerprint,
							},
							hosts: await deps.links.hosts(),
						}
					: null,
				devices: await host.registry.list(personId),
			};
		},
		startPairing: (input) => host.startPairing(input),
		redeemPairing: (input) => host.redeemPairing(input),
		review: (headers, code) => host.review(headers, code),
		approve: (headers, code) => host.approve(headers, code),
		deny: (headers, code) => host.deny(headers, code),
		revoke: (personId, deviceId) => host.revoke(personId, deviceId),
		hello: (key) => host.hello(key),
		join: (input, signal) =>
			joinHost(
				{
					self: deps.self,
					links: deps.hostLinks,
					keys: deps.keys,
					started: (link, key) => deps.links.add(link, key),
				},
				input,
				signal,
			),
	};
}
