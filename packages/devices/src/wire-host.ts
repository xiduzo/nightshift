import type { DeviceCopies } from "@nightshift/engine/device-config";
import type { DevicesDeps } from "./devices-runtime";
import { createHostExchange } from "./exchange";
import type { Handover } from "./handover";
import {
	wireHost as bindHost,
	createDevices,
	createHost,
	type Host,
} from "./host";
import type { DeviceKeyStore, DeviceLinks, HostLinks } from "./links";
import type { HomeMembership } from "./membership";
import type { Reach } from "./reach";
import type { PeerEngine } from "./wire-peers-engine";
import type { SecretsOfDevices } from "./wire-secrets";

/**
 * The Host block of the devices runtime (`startDevices`): this computer
 * as a Host, the Host of run history, and the Devices page it serves.
 */

/** This computer as a Host: pairing, Device keys, presence. */
export function wireHost(
	deps: Pick<DevicesDeps, "auth" | "db" | "settings" | "self" | "disconnect">,
	engine: PeerEngine,
	at: {
		devicesPage: string;
		fingerprint: string | null;
		handover: Pick<Handover, "pending">;
	},
): Host {
	// Both barrel names must stay imported: wireHost is the wire, createHost the alias.
	const bind = bindHost === createHost ? bindHost : createHost;
	return bind({
		auth: deps.auth,
		db: deps.db,
		registry: engine.devices,
		settings: deps.settings,
		self: deps.self,
		devicesPage: at.devicesPage,
		fingerprint: at.fingerprint,
		disconnect: deps.disconnect,
		forgetClones: (deviceId) => engine.projects.forgetDevice(deviceId),
		pending: at.handover.pending,
	});
}

/** This computer as the Host of run history: what paired Devices pull, push and archive. */
export function wireHostExchange(
	deps: Pick<DevicesDeps, "db" | "self" | "ownerId">,
	engine: PeerEngine,
	handover: Pick<Handover, "hub">,
) {
	return createHostExchange({
		db: deps.db,
		engine,
		registry: engine.devices,
		selfId: deps.self.id,
		ownerId: deps.ownerId,
		work: handover.hub,
	});
}

/** The Devices page: this computer as a Host, its Links, its secrets, its identity. */
export function wireDevices(
	deps: Pick<DevicesDeps, "db" | "settings" | "self">,
	engine: PeerEngine,
	at: {
		host: Host;
		links: DeviceLinks;
		hostLinks: HostLinks;
		secrets: SecretsOfDevices;
		keys: DeviceKeyStore;
		machine: string | null;
		keysOf(deviceId: string): Promise<DeviceKeyStore>;
		localOnly: boolean;
		reach: Reach;
		fingerprint: string | null;
		copies: DeviceCopies;
		membership: HomeMembership;
	},
) {
	const { self } = deps;
	return createDevices({
		host: at.host,
		links: at.links,
		hostLinks: at.hostLinks,
		...at.secrets,
		hostSpaces: engine.hostSpaces,
		keys: at.keys,
		identity: {
			machine: at.machine,
			keysOf: at.keysOf,
			adopt: (deviceId, walkerSeq) => engine.devices.adopt(deviceId, walkerSeq),
		},
		localOnly: at.localOnly,
		settings: deps.settings,
		self: { id: self.id, name: self.name, platform: process.platform },
		reach: at.reach,
		fingerprint: at.fingerprint,
		copies: at.copies,
		keptDocument: (deviceId) => engine.keptDevice(deviceId),
		membership: at.membership,
	});
}
