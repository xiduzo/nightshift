import type { Auth } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type {
	Device,
	DeviceDocument,
	KeyStoreKind,
	ProfileStore,
	SettingsStore,
	SpaceDocuments,
} from "@nightshift/engine";
import {
	createDeviceExchange,
	createHostExchange,
	type DeviceExchange,
	type HostExchange,
} from "./exchange";
import { createDevices, createHost, type Devices, type Host } from "./host";
import {
	createDeviceLinks,
	createHostLinks,
	type DeviceLinks,
	deviceKeyStore,
} from "./links";
import {
	createOfferSlots,
	createOffers,
	deviceOffers,
	type Offers,
} from "./offers";
import type { PeerEngine } from "./peers";
import type { Reach } from "./reach";
import { OFFLINE_AFTER_MS } from "./registry";
import {
	createOfferCalls,
	createWorkServer,
	type OfferDeps,
	type WorkHub,
	type WorkServer,
} from "./work";

/** What `bun --hot` keeps of the devices across reloads. */
type Kept = { nightshiftLinks?: DeviceLinks; nightshiftPresence?: Timer };

export type DeviceServices = {
	host: Host;
	hostExchange: HostExchange;
	offers: Offers;
	deviceLinks: DeviceLinks;
	devices: Devices;
};

/**
 * This computer among Devices, once the engine runs: the Host it may be
 * (pairing, Device keys, presence, the exchange of run history), its own
 * Offers, and its links to the Hosts it paired with. Secure by default:
 * the daemon answers this computer only, until it is a Host with an
 * https:// address (`reach`, read at start).
 */
export async function wireDevices(deps: {
	auth: Auth;
	db: Database;
	engine: PeerEngine;
	settings: SettingsStore;
	profiles: ProfileStore;
	document: DeviceDocument;
	spaces: SpaceDocuments;
	/** This computer's Device. */
	self: { id: string; name: string };
	/** The Person who owns this computer. */
	ownerId: string;
	/** This computer as a Device: every computer-touching piece of a step. */
	local: Device;
	/** The calls of the runs this Host walks, for the Devices they are placed on. */
	workHub: WorkHub;
	dataDir: string;
	/** Where the Device keys go: the keychain, else a file (`prefer: "file"`). */
	keyStore: { prefer?: KeyStoreKind };
	reach: Reach;
	/** The SHA-256 fingerprint of the certificate this daemon serves itself. */
	fingerprint: string | null;
	/** The web app's Devices page: pairing codes link to it. */
	devicesPage: string;
	/** Ends the relay connections of a Device whose access was removed. */
	disconnect: (deviceId: string) => void;
	/** Kept across `bun --hot` reloads (the links restart, the sweep moves). */
	kept: Kept;
}): Promise<DeviceServices> {
	const { db, engine, self, ownerId, local } = deps;

	/** This computer as a Host: pairing, Device keys, presence. */
	const host = createHost({
		auth: deps.auth,
		db,
		registry: engine.devices,
		settings: deps.settings,
		self,
		devicesPage: deps.devicesPage,
		fingerprint: deps.fingerprint,
		disconnect: deps.disconnect,
	});

	/**
	 * This computer's Offers, for the steps of other Persons' runs it serves:
	 * the sessions and calls running under each, for every Host and itself.
	 */
	const offerDeps: OfferDeps = {
		offers: () => deviceOffers(deps.document),
		profileFor: (name) => deps.profiles.settingsFor(name),
		slots: createOfferSlots(),
		calls: createOfferCalls(),
	};

	/** This computer as the Host of run history: what paired Devices pull, push and archive. */
	const hostExchange = createHostExchange({
		db,
		engine,
		registry: engine.devices,
		selfId: self.id,
		ownerId,
		isHost: host.isHost,
		work: deps.workHub,
		local,
		offerDeps,
	});

	if (deps.kept.nightshiftPresence) clearInterval(deps.kept.nightshiftPresence);
	deps.kept.nightshiftPresence = setInterval(() => {
		engine.devices.sweep(OFFLINE_AFTER_MS).catch((error) => {
			console.error("Device presence was not updated:", error);
		});
	}, 5_000);
	deps.kept.nightshiftPresence.unref();

	/** Per Host: this computer as the Device the Host's runs are placed on. */
	const workServers = new Map<string, WorkServer>();
	function workServer(hostId: string): WorkServer {
		let server = workServers.get(hostId);
		if (!server) {
			server = createWorkServer({
				hostId,
				db,
				engine,
				device: local,
				...offerDeps,
			});
			workServers.set(hostId, server);
		}
		return server;
	}

	/**
	 * Per Host: this computer's half of the exchange of run history. It
	 * lives as long as the daemon, so a command it applied is not applied
	 * again when the link drops and comes back.
	 */
	const deviceExchanges = new Map<string, DeviceExchange>();
	function deviceExchange(hostId: string): DeviceExchange {
		let exchange = deviceExchanges.get(hostId);
		if (!exchange) {
			exchange = createDeviceExchange({ engine, hostId, selfId: self.id });
			deviceExchanges.set(hostId, exchange);
		}
		return exchange;
	}

	/** This computer's Offers into Spaces, as its owner makes and withdraws them. */
	const offers = createOffers({
		db,
		engine,
		document: deps.document,
		profiles: deps.profiles,
		self: { id: self.id, name: self.name },
		ownerId,
		withdrawn: (spaceId, profile) =>
			offerDeps.calls.withdrawn(spaceId, profile),
	});

	/** This computer's links to the Hosts it paired with. Restarted on `bun --hot`. */
	const hostLinks = createHostLinks(db);
	const keyStore = await deviceKeyStore({
		dataDir: deps.dataDir,
		...deps.keyStore,
	});
	await deps.kept.nightshiftLinks?.close();
	deps.kept.nightshiftLinks = createDeviceLinks({
		links: hostLinks,
		keys: keyStore,
		document: deps.document,
		// The Spaces the Host lists: kept here as the Host's, their documents
		// synced read-only, before run rows that name their projects arrive.
		spaceDocuments: async (link, hello) => {
			const { hostSpaces } = engine.exchange;
			await hostSpaces.update(
				{ id: link.hostId, name: hello.host.name },
				hello.spaces,
				ownerId,
			);
			const kept = new Set(await hostSpaces.ofHost(link.hostId));
			return Promise.all(
				hello.spaces
					.filter((space) => kept.has(space.id))
					.map(async (space) => {
						const opened = await deps.spaces.open(space.id);
						return { name: opened.name, doc: opened.doc };
					}),
			);
		},
		// Run history both ways, the commands for the runs this computer walks,
		// and the steps of the Host's runs placed on this computer.
		attach: (hostLink, link) => {
			const stops = [
				deviceExchange(hostLink.hostId).attach(link),
				workServer(hostLink.hostId).attach(link),
			];
			return () => {
				for (const stop of stops) stop();
			};
		},
	});
	await deps.kept.nightshiftLinks.start();
	const deviceLinks = deps.kept.nightshiftLinks;

	const devices = createDevices({
		host,
		links: deviceLinks,
		hostLinks,
		hostSpaces: engine.exchange.hostSpaces,
		keys: keyStore,
		settings: deps.settings,
		self: { id: self.id, name: self.name, platform: process.platform },
		reach: deps.reach,
		fingerprint: deps.fingerprint,
	});

	return { host, hostExchange, offers, deviceLinks, devices };
}
