import type { SettingsStore } from "@nightshift/engine";
import {
	type DeviceKeyStore,
	type DeviceLinks,
	type HostLinks,
	type HostSpaces,
	joinHost,
} from "../links";
import { type Reach, reachFor } from "../reach";
import type { Host } from "./host";
import type { Devices, DevicesOverview } from "./types";

/** The API's `Devices`: this computer as a Host, and its own links to Hosts. */
export function createDevices(deps: {
	host: Host;
	links: DeviceLinks;
	hostLinks: HostLinks;
	/** The Spaces this computer takes part in through each Host. */
	hostSpaces: Pick<HostSpaces, "listed">;
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
							hosts: await Promise.all(
								(await deps.links.hosts()).map(async (linked) => ({
									...linked,
									spaces: await deps.hostSpaces.listed(linked.hostId),
								})),
							),
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
