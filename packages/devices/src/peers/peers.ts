import type { Database } from "@nightshift/db";
import {
	type ArchiveHost,
	createSpaceArchive,
	type DeviceProfile,
	type PeerContext,
	type PeerProjects,
	type Peers,
	type SpaceArchive,
} from "@nightshift/engine";
import type { DeviceCopies } from "@nightshift/engine/device-config";
import { memberName, memberRole } from "@nightshift/engine/projects";
import type { HostRelay, RunCommand, WorkRelay } from "../contract";
import { createRunHistoryExchange, type RunHistoryExchange } from "../exchange";
import { createHostSpaces, type HostSpaces } from "../links";
import {
	createEngineOffers,
	createOfferAdmission,
	createOfferedSessions,
	createScheduleOffers,
	type DeviceOffer,
	type EngineOffers,
	type OfferAdmission,
	type OfferUse,
} from "../offers";
import { createPlacement } from "../placement";
import {
	createDeviceRegistry,
	type DevicePresence,
	type DeviceRegistry,
} from "../registry";
import { createPrivatePaths } from "./private-paths";
import { createWalkers } from "./walkers";

/** What the peers take beside the engine's own parts. */
export type PeerOptions = {
	/** The Hosts this computer links to (`createRelay`). None on a computer alone. */
	relay?: HostRelay;
	/**
	 * This Replica's Space archive, which its knowledge shares. The peers
	 * connect it to the relay. Default: one over the engine's `dataDir`.
	 */
	archive?: SpaceArchive;
	/**
	 * On a Host: how its runs reach the Devices they are placed on (the
	 * hub those Devices pull their work from). Without it, every run runs
	 * on this computer.
	 */
	work?: WorkRelay;
	/**
	 * This computer's own Offers (its Device document). A run of another
	 * Person placed here may use only those the Space also lists. Without
	 * it, this computer offers nothing.
	 */
	ownOffers?: () => readonly DeviceOffer[];
	/** This computer's profiles, which its owner may use. Without it, unknown. */
	ownProfiles?: () => readonly DeviceProfile[];
	/**
	 * The copies of the documents of this computer's owner's other Devices
	 * (`createDeviceCopies`): their names and profiles while the home Host
	 * cannot be reached. Without it, none.
	 */
	copies?: Pick<DeviceCopies, "list">;
	/**
	 * Whether a Person's role in a Space lets them use Offers (`offer.use`),
	 * the Host's check before it places another Person's run through one.
	 * Without it, nobody uses Offers here.
	 */
	mayUseOffers?: (spaceId: string, personId: string) => Promise<boolean>;
	/**
	 * The sessions and calls under each of this computer's Offers, which a
	 * `bun --hot` reload hands to the next engine. Without it, the engine
	 * makes its own.
	 */
	offerUse?: OfferUse;
	/**
	 * On a Host: the Devices online now, which a `bun --hot` reload hands
	 * to the next engine's registry. Without it, every Device starts offline.
	 */
	presence?: DevicePresence;
};

/** The Members of a Space, as its document mirrors them: a Person this Replica may have no account of. */
export type SpaceMembers = {
	/** A Person's role in a Space. */
	role(spaceId: string, personId: string): Promise<string | null>;
	/** A Member's name. */
	name(spaceId: string, personId: string): Promise<string | null>;
};

/** The port the engine walks with, and what the daemon uses beside it. */
export type BuiltPeers = {
	port: Peers;
	/** On a Host: the Devices that paired with it. */
	registry: DeviceRegistry;
	/** Run history between this Replica and its Hosts. */
	exchange: RunHistoryExchange;
	/** The Spaces the Hosts this computer links to keep. */
	hostSpaces: HostSpaces;
	/** The Members of each Space. */
	members: SpaceMembers;
	/** The Offers of the Spaces. */
	offers: EngineOffers;
	/** This computer's admission of the calls of runs: every Offer check, one slot map per Offer. */
	admission: OfferAdmission;
	/** The Projects and their Clones, as the engine gives them to the peers. */
	projects: PeerProjects;
	/** What the Device documents this Replica keeps say of those Devices. */
	keptDevice: PeerContext["keptDevice"];
	/** This Replica's Space archive, connected to its Hosts. */
	archive: SpaceArchive;
};

/** The Hosts of a computer alone: none, so it keeps every Space. */
const ALONE: ArchiveHost = {
	archivePut: async () => false,
	archiveGet: async () => null,
};

/**
 * The peers of this computer, over what the engine offers them
 * (`PeerContext`) and their own rows (`own.db`) and files (`own.dataDir`):
 * the device registry, Placement, Offers, the archive and the exchange of
 * run history, wired into the engine's port (`Peers`).
 */
export function createPeers(
	context: PeerContext,
	own: { db: Database; dataDir: string },
	options: PeerOptions = {},
): BuiltPeers {
	const { device, history, documents, now } = context;
	const { db, dataDir } = own;
	const { relay } = options;
	const registry = createDeviceRegistry({
		db,
		logFact: context.logFact,
		history,
		now,
		...(options.presence ? { presence: options.presence } : {}),
	});
	const hostSpaces = createHostSpaces(db);

	/** The offered sessions running now: what withdrawing an Offer stops. */
	const offeredSessions = createOfferedSessions();
	const work = options.work && offeredSessions.relay(options.work);
	/**
	 * Every call of another Person's run on this computer, walked here or
	 * sent by a Walker elsewhere: one admission, one slot map per Offer.
	 */
	const admission = createOfferAdmission({
		db,
		device,
		documents,
		projects: context.projects,
		...(options.ownOffers ? { ownOffers: options.ownOffers } : {}),
		profileFor: context.profiles.here,
		...(options.offerUse ? { use: options.offerUse } : {}),
		sessions: offeredSessions,
	});

	/** Where a run's steps run: its plan at start, read while it walks (`placement.ts`). */
	const placement = createPlacement({
		db,
		device,
		walkerId: context.walkerId,
		registry,
		documents,
		hostSpaces,
		projects: context.projects,
		profiles: context.profiles,
		keptDevice: context.keptDevice,
		flows: context.flows,
		...(work ? { work } : {}),
		...(relay ? { relay } : {}),
		// Another Person's run here uses this computer through its Offers.
		localFor: admission.deviceFor,
		offersHere: admission.inForce,
		...(options.ownProfiles ? { ownProfiles: options.ownProfiles } : {}),
		...(options.copies ? { copies: options.copies } : {}),
		mayUseOffers: (spaceId, personId) =>
			options.mayUseOffers?.(spaceId, personId) ?? Promise.resolve(false),
	});

	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	const hostOf = (spaceId: string) => hostSpaces.hostOf(spaceId);
	// Files go to the Hosts and come from them through the relay. A
	// computer alone keeps every Space.
	const archive = options.archive ?? createSpaceArchive(dataDir);
	archive.connect(relay ?? ALONE);
	const exchange = createRunHistoryExchange({
		db,
		archive,
		context,
		hostSpaces,
		// A Space a Host keeps: that Host's feed of the step, over its link.
		...(relay?.follow ? { upstream: relay.follow.bind(relay) } : {}),
	});

	const offers = createEngineOffers({
		ready: context.ready,
		documents,
		logFact: context.logFact,
		deviceId: device.id,
		now,
		hostOf,
		...(relay ? { relay } : {}),
		async stopUnder(offer) {
			await Promise.all(
				offeredSessions.runsUnder(offer).map((runId) =>
					context.runs.stop(runId).catch((error) => {
						console.error(`The run ${runId} was not stopped:`, error);
					}),
				),
			);
		},
	});

	const port: Peers = {
		placement,
		offers: {
			schedulesWithOffers: createScheduleOffers({
				db,
				documents,
				namesFor: placement.namesFor,
				offersHere: admission.inForce,
				...(options.mayUseOffers ? { mayUseOffers: options.mayUseOffers } : {}),
			}),
		},
		runs: {
			walkers: createWalkers({
				db,
				walkerId: context.walkerId,
				device,
				documents,
			}),
			pendingCommands: async (runIds) => {
				const byRun = new Map<
					string,
					Pick<RunCommand, "id" | "kind" | "createdAt">[]
				>();
				for (const c of await exchange.commands.pendingOf(runIds)) {
					const pending = byRun.get(c.runId) ?? [];
					pending.push({ id: c.id, kind: c.kind, createdAt: c.createdAt });
					byRun.set(c.runId, pending);
				}
				return byRun;
			},
			stepEntries: (step, afterSeq, signal) =>
				exchange.feeds.entries(step, afterSeq, signal),
			async keepWalk(files) {
				for (const file of files) await archive.put(file);
			},
			async archived(ref) {
				const known =
					ref.kind === "checkpoint" ? null : await context.runs.stepStamp(ref);
				return archive.read(ref, known);
			},
		},
		...(relay ? { relay } : {}),
		pathsFor: createPrivatePaths({ db, registry, ownerId: context.ownerId }),
	};

	const members: SpaceMembers = {
		role: async (spaceId, personId) =>
			memberRole(await documents.open(spaceId), personId),
		name: async (spaceId, personId) =>
			memberName(await documents.open(spaceId), personId),
	};

	return {
		port,
		registry,
		exchange,
		hostSpaces,
		members,
		offers,
		admission,
		projects: context.projects,
		keptDevice: context.keptDevice,
		archive,
	};
}
