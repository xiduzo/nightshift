import { type Auth, roleAllows } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	createDeviceCopies,
	type Device,
	type DeviceDocument,
	type FlowDocuments,
	type KeyStoreKind,
	type MoveRows,
	memberRole,
	type ProfileStore,
	profileChoice,
	type SettingsStore,
	type SpaceDocuments,
	storedDeviceCopy,
} from "@nightshift/engine";
import type * as Y from "yjs";
import {
	type AppliedCommands,
	createDeviceExchange,
	createHostExchange,
	type HostExchange,
} from "./exchange";
import {
	createDevices,
	createHost,
	type Devices,
	type Host,
	type PendingPairings,
} from "./host";
import {
	createDeviceLinks,
	createHostLinks,
	deviceKeyStore,
	type LinkOptions,
} from "./links";
import { createHomeMembership } from "./membership";
import {
	createOffers,
	createOfferUse,
	deviceOffers,
	type Offers,
	type OfferUse,
	offeredProfile,
} from "./offers";
import {
	createPeerEngine,
	type PeerEngine,
	type PeerEngineOptions,
} from "./peers";
import { listenHostname, ownCertificate, type Reach, reachFor } from "./reach";
import { type DevicePresence, OFFLINE_AFTER_MS } from "./registry";
import { createRelay, createWorkRelay } from "./relay";
import {
	createWorkHub,
	createWorkServer,
	type ServedCalls,
	servedCalls,
	type WorkHub,
} from "./work";

/** This computer among Devices, as the daemon uses it (`startDevices`). */
export type DevicesRuntime = {
	/** This computer's engine, wired to its peers (`createPeerEngine`). */
	engine: PeerEngine;
	/** This computer as a Host: the Device key of a request, and of a relay connection. */
	host: Pick<Host, "keyOf" | "syncKey">;
	/** The API's ports: the Devices page, the Host's exchange of run history, the Offers. */
	devices: Devices;
	hostExchange: HostExchange;
	offers: Offers;
	/** Whom this daemon answers since it started: this computer, or the network. */
	reach: Reach;
	/** How Bun serves this daemon: the hostname of its reach, and its own TLS. */
	serve: { hostname: string; tls?: { cert: string; key: string } };
};

/**
 * What `bun --hot` keeps of the devices: one slot, the handover of the
 * newest runtime.
 */
export type KeptDevices = {
	nightshiftDevices?: Handover;
	/**
	 * A daemon from before the devices runtime kept these apart. The first
	 * runtime stops them as a handover does, and keeps the work hub.
	 */
	nightshiftEngine?: { dispose(): Promise<void> };
	nightshiftWork?: WorkHub;
	nightshiftLinks?: { close(): Promise<void> };
	nightshiftPresence?: Timer;
};

/**
 * What one runtime hands the next across a reload. The parts outlive the
 * runtime that made them; each runtime binds them to its own engine.
 */
type Handover = {
	/**
	 * On a Host: the calls of the runs it walks, for the Devices they are
	 * placed on. A Device's stream outlives a reload.
	 */
	readonly hub: WorkHub;
	/**
	 * The sessions and the calls under each of this computer's Offers, by
	 * either path: the engine's Offer admission counts them in one slot map
	 * per Offer, so a session that runs on through a reload still counts.
	 */
	readonly offerUse: OfferUse;
	/**
	 * On a Host: the Devices online now, and the pairings in progress. A
	 * Device's link outlives a reload, and so does a code it asked for.
	 * Not read-only: a runtime of an older version kept neither.
	 */
	presence: DevicePresence;
	pending: PendingPairings;
	/** Per Host: the commands this computer applied, and the calls it serves as a placed Device. */
	readonly hosts: Map<
		string,
		{ applied: AppliedCommands; served: ServedCalls }
	>;
	/** A Device took work again: the newest engine's steps that wait for it look again. */
	wake(deviceId: string): void;
	/** Stops what the next runtime replaces: the Links, the presence sweep, then the engine. */
	release(): Promise<void>;
};

export type DevicesDeps = {
	auth: Auth;
	db: Database;
	/**
	 * Read at start: the certificate this daemon serves itself
	 * (NIGHTSHIFT_TLS_CERT, NIGHTSHIFT_TLS_KEY), the hostname a Host binds
	 * (NIGHTSHIFT_LISTEN), and the web app, whose Devices page pairing
	 * codes link to (CORS_ORIGIN).
	 */
	env: {
		CORS_ORIGIN: string;
		NIGHTSHIFT_LISTEN?: string;
		NIGHTSHIFT_TLS_CERT?: string;
		NIGHTSHIFT_TLS_KEY?: string;
	};
	settings: SettingsStore;
	profiles: ProfileStore;
	document: DeviceDocument;
	spaces: SpaceDocuments;
	/** The flow documents of the Projects: this Device keeps a copy of each. */
	flows: FlowDocuments;
	/** This computer's Device. */
	self: { id: string; name: string };
	/** The Person who owns this computer. */
	ownerId: string;
	/** This computer as a Device: every computer-touching piece of a step. */
	local: Device;
	dataDir: string;
	/** Where the Device keys go: the keychain, else a file (`prefer: "file"`). */
	keyStore: { prefer?: KeyStoreKind };
	/** The engine's scheduler: off, or on until the signal aborts. */
	scheduler: PeerEngineOptions["scheduler"];
	/** A secret's value by name: the secret a webhook schedule names. */
	secret?: PeerEngineOptions["secret"];
	/** Ends the relay connections of a Device whose access was removed. */
	disconnect(deviceId: string): void;
	/**
	 * What a Space move moves beside the rows of the engine and of
	 * `devices`, in the same batch: the notifier's deliveries of the moved
	 * runs, which this package does not import.
	 */
	moveRows?: readonly MoveRows[];
	/** Kept across `bun --hot` reloads: what the runtime before this one hands over. */
	kept: KeptDevices;
	/** Knobs for tests only. */
	internals?: {
		engine?: Parameters<typeof createPeerEngine>[1];
		links?: LinkOptions;
		/** How often the presence sweep runs. Default 5 s. */
		presenceMs?: number;
	};
};

/**
 * This computer among Devices: its engine with its peers, the Host it may
 * be (pairing, Device keys, presence, the exchange of run history), its
 * Offers, and its Links to the Hosts it paired with, each with the
 * exchange and the work server over it. Secure by default: the daemon
 * answers this computer only, until it is a Host with an https:// address
 * (`reach`, read at start).
 *
 * It owns its reload, as `Engine.dispose` does for runs. `bun --hot` calls
 * it again in the same process. The runtime before lets go first: its
 * Links and presence sweep stop, the commands it is applying end, and its
 * engine lets go of its runs. Then this one takes over what must outlive
 * the reload (the work hub, the applied commands, the calls served as a
 * placed Device, the Offers in use, the Devices online and the pairings
 * in progress) and binds them to its own engine.
 */
export async function startDevices(deps: DevicesDeps): Promise<DevicesRuntime> {
	const { db, self, ownerId, local } = deps;
	// What can fail comes first: then the runtime before keeps running.
	const reach = reachFor(deps.settings.current());
	const certificate = ownCertificate(deps.env);
	const fingerprint = certificate?.fingerprint ?? null;
	const devicesPage = new URL("/devices", deps.env.CORS_ORIGIN).toString();
	const hostLinks = createHostLinks(db);
	const keyStore = await deviceKeyStore({
		dataDir: deps.dataDir,
		...deps.keyStore,
	});

	const handover = await takeOver(deps.kept);

	/** Per Host: what outlives a reload. */
	function keptFor(hostId: string) {
		let kept = handover.hosts.get(hostId);
		if (!kept) {
			kept = { applied: new Map(), served: servedCalls() };
			handover.hosts.set(hostId, kept);
		}
		return kept;
	}

	/**
	 * Read-only copies of the documents of this computer's owner's other
	 * Devices, from the home Host: their names, profiles and secret names.
	 */
	const copies = createDeviceCopies({ db, selfId: self.id });

	// The engine takes the relays, and the relays reach the engine and the
	// Links: they read both when they are called, after this function.
	const engine = createPeerEngine(
		{
			db,
			walkerId: self.id,
			device: local,
			dataDir: deps.dataDir,
			settings: () => deps.settings.run(),
			// A flow names a profile by its id. A Walker of an older Night
			// Shift asks by the name, which an old profile's id is.
			profileFor: (id) =>
				deps.profiles.settingsFor(id) ??
				deps.profiles.settingsFor(deps.profiles.byName(id)?.id ?? ""),
			spaceDocuments: deps.spaces,
			flowDocuments: deps.flows,
			// The import on upgrade gives a Clone's project profiles to this Device.
			profiles: deps.profiles,
			scheduler: deps.scheduler,
			...(deps.secret ? { secret: deps.secret } : {}),
			...(deps.moveRows ? { moveRows: deps.moveRows } : {}),
			// The hub for the Spaces this computer keeps; its Hosts for the others.
			work: createWorkRelay({
				hub: handover.hub,
				engine: () => engine,
				links: () => links,
			}),
			// The actions on rows another Device owns, carried over the Links.
			relay: createRelay({
				engine: () => engine,
				registry: () => engine.devices,
				links: () => links,
				flows: deps.flows,
			}),
			// This computer's own Offers, the sessions and calls under them,
			// and who may use Offers in a Space.
			ownOffers: () =>
				deviceOffers(
					deps.document,
					(profile) => offeredProfile(deps.profiles, profile)?.name ?? null,
				),
			ownProfiles: () => deps.profiles.list().map(profileChoice),
			copies,
			offerUse: handover.offerUse,
			presence: handover.presence,
			mayUseOffers: async (spaceId, personId) => {
				const role = memberRole(await deps.spaces.open(spaceId), personId);
				return role !== null && roleAllows(role, { offer: ["use"] });
			},
		},
		deps.internals?.engine,
	);

	/** This computer as a Host: pairing, Device keys, presence. */
	const host = createHost({
		auth: deps.auth,
		db,
		registry: engine.devices,
		settings: deps.settings,
		self,
		devicesPage,
		fingerprint,
		disconnect: deps.disconnect,
		pending: handover.pending,
	});

	/** This computer as the Host of run history: what paired Devices pull, push and archive. */
	const hostExchange = createHostExchange({
		db,
		engine,
		documents: deps.spaces,
		registry: engine.devices,
		selfId: self.id,
		ownerId,
		isHost: host.isHost,
		work: handover.hub,
	});

	/** This computer's Offers into Spaces, as its owner makes and withdraws them. */
	const offers = createOffers({
		db,
		engine,
		document: deps.document,
		profiles: deps.profiles,
		self: { id: self.id, name: self.name },
		ownerId,
		withdrawn: (spaceId, profile) =>
			engine.admission.withdrawn(spaceId, profile),
	});

	/** This computer's links to the Hosts it paired with. */
	const links = createDeviceLinks({
		links: hostLinks,
		keys: keyStore,
		document: deps.document,
		// The Spaces the Host lists: kept here as the Host's, their documents
		// synced read-only, before run rows that name their projects arrive.
		// The flow documents of their Projects sync both ways. A Project the
		// Host adds later syncs from its next answer.
		spaceDocuments: async (link, hello) => {
			const { hostSpaces } = engine;
			await hostSpaces.update(
				{ id: link.hostId, name: hello.host.name },
				hello.spaces,
				ownerId,
			);
			const kept = new Set(await hostSpaces.ofHost(link.hostId));
			return hostSpaceDocuments(
				deps,
				hello.spaces.filter((space) => kept.has(space.id)).map((s) => s.id),
			);
		},
		// The Devices the home Host lists: only this Person's own.
		deviceDocuments: (_link, hello) => copies.keep(hello.devices ?? []),
		// Without its home Host this computer learns nothing of the others,
		// and its Personal splits off the Host's: it keeps a copy.
		revoked: async (link) => {
			await membership.revoked(link).catch(() => {
				// It waits for the runs this computer walks: `keepFinishing` tries again.
			});
		},
		// Run history both ways, the commands for the runs this computer walks,
		// and the steps of the Host's runs placed on this computer.
		attach: (hostLink, link) => {
			const { hostId } = hostLink;
			const { applied, served } = keptFor(hostId);
			const stops = [
				createDeviceExchange({
					engine,
					hostId,
					selfId: self.id,
					applied,
				}).attach(link),
				// Every call passes the engine's Offer admission.
				createWorkServer({
					serve: (request, signal) =>
						engine.admission.serve(request, { hostId }, signal),
					served,
					// A session for a Walker that this computer cannot reach stops.
					replyDeadlineMs: () =>
						deps.settings.current().offlineWorkMinutes * 60_000,
				}).attach(link),
			];
			return () => {
				for (const stop of stops) stop();
			};
		},
		...(deps.internals?.links ? { linkOptions: deps.internals.links } : {}),
	});

	/**
	 * This computer's membership of its home Host (ADR 1): the merge of its
	 * Personal into the Host's, and the split when it leaves.
	 */
	const membership = createHomeMembership({
		db,
		engine,
		links,
		hostLinks,
		keys: keyStore,
		copies,
		spaces: deps.spaces,
		flows: deps.flows,
		self,
		ownerId,
		dataDir: deps.dataDir,
	});
	// A merge that moved its rows finishes when its Host answers. A split
	// starts once this computer left its Host, and finishes by itself.
	const finishing = new AbortController();
	membership.keepFinishing(finishing.signal);

	const presence = setInterval(() => {
		engine.devices.sweep(OFFLINE_AFTER_MS).catch((error) => {
			console.error("Device presence was not updated:", error);
		});
	}, deps.internals?.presenceMs ?? 5_000);
	presence.unref();

	// From here the next runtime takes over from this one.
	handover.wake = (deviceId) => {
		engine.deviceBack(deviceId).catch((error) => {
			console.error("Steps that waited for a device were not woken:", error);
		});
	};
	handover.release = async () => {
		finishing.abort();
		clearInterval(presence);
		await links.close();
		await copies.close();
		// A command this engine is applying ends here: the next runtime
		// reports its result, and does not apply it again.
		await Promise.allSettled(
			[...handover.hosts.values()].flatMap(({ applied }) => [
				...applied.values(),
			]),
		);
		await letGo(engine);
	};
	deps.kept.nightshiftDevices = handover;

	await links.start();

	const devices = createDevices({
		host,
		links,
		hostLinks,
		hostSpaces: engine.hostSpaces,
		keys: keyStore,
		settings: deps.settings,
		self: { id: self.id, name: self.name, platform: process.platform },
		reach,
		fingerprint,
		copies,
		keptDocument: (deviceId) => storedDeviceCopy(db, deviceId),
		membership,
	});

	return {
		engine,
		host,
		devices,
		hostExchange,
		offers,
		reach,
		serve: {
			hostname: listenHostname(reach, deps.env.NIGHTSHIFT_LISTEN),
			...(certificate
				? { tls: { cert: certificate.cert, key: certificate.key } }
				: {}),
		},
	};
}

/**
 * The handover of the runtime before this one, once it let go. Fresh on
 * the first start. A daemon from before the devices runtime kept its
 * parts in four slots: they stop the same way, and its work hub stays, so
 * a Device's stream outlives that reload too. That hub still wakes the
 * engine before it until the next restart.
 */
async function takeOver(kept: KeptDevices): Promise<Handover> {
	const before = kept.nightshiftDevices;
	if (before) {
		await before.release();
		// Nothing keeps the runtime before: a Device back meanwhile waits for its minute.
		before.wake = () => {};
		before.release = async () => {};
		// A runtime of an older version kept less: what it lacks starts
		// empty here, in the same handover (its work hub wakes through it).
		const older: Partial<Pick<Handover, "presence" | "pending">> = before;
		older.presence ??= new Map();
		older.pending ??= new Map();
		return before;
	}
	await kept.nightshiftLinks?.close();
	if (kept.nightshiftPresence) clearInterval(kept.nightshiftPresence);
	if (kept.nightshiftEngine) await letGo(kept.nightshiftEngine);
	const hub = kept.nightshiftWork;
	kept.nightshiftLinks = undefined;
	kept.nightshiftPresence = undefined;
	kept.nightshiftEngine = undefined;
	kept.nightshiftWork = undefined;
	const handover: Handover = {
		hub:
			hub ?? createWorkHub({ onBack: (deviceId) => handover.wake(deviceId) }),
		offerUse: createOfferUse(),
		presence: new Map(),
		pending: new Map(),
		hosts: new Map(),
		wake: () => {},
		release: async () => {},
	};
	return handover;
}

/** The engine before a reload lets go of its runs: else its drives run on beside the next engine's. */
async function letGo(engine: { dispose(): Promise<void> }): Promise<void> {
	await engine.dispose().catch((error) => {
		console.error(
			"The engine before the reload did not let go of its runs:",
			error,
		);
	});
}

/**
 * What a Device syncs of the Spaces a Host keeps: each Space document,
 * which it only receives, and the flow documents of each Project in it,
 * which it keeps a copy of and changes too (ADR 2).
 */
export async function hostSpaceDocuments(
	documents: {
		spaces: Pick<SpaceDocuments, "open">;
		flows: Pick<FlowDocuments, "open">;
	},
	spaceIds: readonly string[],
): Promise<{ name: string; doc: Y.Doc }[]> {
	const synced: { name: string; doc: Y.Doc }[] = [];
	for (const spaceId of spaceIds) {
		const space = await documents.spaces.open(spaceId);
		synced.push({ name: space.name, doc: space.doc });
		for (const projectId of [...space.projects.keys()].sort()) {
			const { current, history } = await documents.flows.open(projectId);
			synced.push(
				{ name: current.name, doc: current.doc },
				{ name: history.name, doc: history.doc },
			);
		}
	}
	return synced;
}
