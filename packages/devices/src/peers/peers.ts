import {
	type DeviceCopies,
	type DeviceProfile,
	memberName,
	memberRole,
	type PeerContext,
	type Peers,
} from "@nightshift/engine";
import { createRunArchive } from "../archive";
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
};

/**
 * The peers of this computer, over the engine's own parts: the device
 * registry, Placement, Offers, the archive and the exchange of run
 * history, wired into the engine's port (`Peers`).
 */
export function createPeers(
	context: PeerContext,
	options: PeerOptions = {},
): BuiltPeers {
	const { db, dataDir, device, log, history, documents, now } = context;
	const { relay } = options;
	const registry = createDeviceRegistry({
		db,
		log,
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
		...(options.ownOffers ? { ownOffers: options.ownOffers } : {}),
		...(context.profileFor ? { profileFor: context.profileFor } : {}),
		...(options.offerUse ? { use: options.offerUse } : {}),
		sessions: offeredSessions,
	});

	/** Where a run's steps run: its plan at start, read while it walks (`placement.ts`). */
	const placement = createPlacement({
		db,
		device,
		log,
		registry,
		documents,
		hostSpaces,
		project: context.project,
		...(context.profileFor ? { profileFor: context.profileFor } : {}),
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
	const archive = createRunArchive({
		dataDir,
		hostOf,
		...(relay ? { relay } : {}),
		stepStamp: context.stepStamp,
	});
	const exchange = createRunHistoryExchange({
		context,
		hostSpaces,
		// A Space a Host keeps: that Host's feed of the step, over its link.
		...(relay?.follow ? { upstream: relay.follow.bind(relay) } : {}),
		// And its archive copy of a step that ended.
		archived: archive.archived,
	});

	const offers = createEngineOffers({
		ready: context.ready,
		documents,
		log,
		deviceId: device.id,
		now,
		hostOf,
		...(relay ? { relay } : {}),
		async stopUnder(offer) {
			await Promise.all(
				offeredSessions.runsUnder(offer).map((runId) =>
					context.stopRun(runId).catch((error) => {
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
		hostOf,
		runs: {
			walkers: createWalkers({ db, log, device, documents }),
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
			keepWalk: archive.keepWalk,
			archived: archive.archived,
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
	};
}
