import type { PeerContext, Peers } from "@nightshift/engine";
import { createRunArchive, runsMovedHere } from "../archive";
import type { HostRelay, WorkRelay } from "../contract";
import { createEngineExchange, type EngineExchange } from "../exchange";
import { createHostSpaces, personOnHost } from "../links";
import {
	createEngineOffers,
	createOfferedSessions,
	createOffersHere,
	createScheduleOffers,
	type DeviceOffer,
	type EngineOffers,
	offerRefusal,
} from "../offers";
import { createPlacement } from "../placement";
import { createDeviceRegistry, type DeviceRegistry } from "../registry";
import { createPrivatePaths } from "./private-paths";
import { createWalkers } from "./walkers";

/** What the peers take beside the engine's own parts. */
export type PeerOptions = {
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
	/**
	 * Whether a Person's role in a Space lets them use Offers (`offer.use`),
	 * the Host's check before it places another Person's run through one.
	 * Without it, nobody uses Offers here.
	 */
	mayUseOffers?: (spaceId: string, personId: string) => Promise<boolean>;
};

/** The port the engine walks with, and what the daemon uses beside it. */
export type BuiltPeers = {
	port: Peers;
	/** On a Host: the Devices that paired with it. */
	registry: DeviceRegistry;
	/** Run history between this Replica and others. */
	exchange: EngineExchange;
	/** The Offers of the Spaces. */
	offers: EngineOffers;
};

/**
 * The peers of this computer, over the engine's own parts: the device
 * registry, Placement, Offers, the archive and the exchange of run
 * history, wired into the engine's port (`Peers`).
 */
export function createPeers(
	context: Omit<PeerContext, "relay"> & { relay?: HostRelay },
	options: PeerOptions = {},
): BuiltPeers {
	const { db, dataDir, device, log, bus, history, documents, now, relay } =
		context;
	const registry = createDeviceRegistry({ db, log, history, now });

	/** The offered sessions running now: what withdrawing an Offer stops. */
	const offeredSessions = createOfferedSessions();
	const work = options.work && offeredSessions.relay(options.work);
	const { offersHere, localFor } = createOffersHere({
		db,
		device,
		documents,
		...(options.ownOffers ? { ownOffers: options.ownOffers } : {}),
		...(context.profileFor ? { profileFor: context.profileFor } : {}),
		ownerId: context.ownerId,
		sessions: offeredSessions,
	});

	/** Where steps run: per node, else the run's Device (`placement.ts`). */
	const placement = createPlacement({
		db,
		device,
		log,
		registry,
		documents,
		hostSpaces: createHostSpaces(db),
		project: context.project,
		...(work ? { work } : {}),
		...(relay ? { relay } : {}),
		// Another Person's run here uses this computer through its Offers.
		localFor,
		offersHere,
		mayUseOffers: (spaceId, personId) =>
			options.mayUseOffers?.(spaceId, personId) ?? Promise.resolve(false),
	});

	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	const hostOf = (spaceId: string) => exchange.hostSpaces.hostOf(spaceId);
	const archive = createRunArchive({
		dataDir,
		hostOf,
		...(relay ? { relay } : {}),
	});
	const exchange = createEngineExchange({
		db,
		log,
		bus,
		history,
		walks: context.walks,
		stepEnded: context.stepEnded,
		dataDir,
		documents,
		// A run moved here: this computer walks it from now on.
		onIngested: async (added) => {
			const here = [await log.walkerId(), device.id];
			for (const runId of runsMovedHere(added, here)) {
				await context.takeOver(runId).catch((error) => {
					console.error(`[engine] could not take over run ${runId}`, error);
				});
			}
		},
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
			refusal: offerRefusal,
			schedulesWithOffers: createScheduleOffers({
				db,
				documents,
				devicesFor: placement.devicesFor,
				offersHere,
				...(options.mayUseOffers ? { mayUseOffers: options.mayUseOffers } : {}),
			}),
		},
		hostOf,
		personOnHost: (spaceId) => personOnHost(db, spaceId),
		runs: {
			walkers: createWalkers({ db, log, device, documents }),
			pendingCommands: async (runId) =>
				(await exchange.commands.pendingOf(runId)).map((c) => ({
					id: c.id,
					kind: c.kind,
					createdAt: c.createdAt,
				})),
			stepEntries: (step, afterSeq, signal) =>
				exchange.feeds.entries(step, afterSeq, signal),
			keepWalk: archive.keepWalk,
			archived: archive.archived,
		},
		pathsFor: createPrivatePaths({ db, registry, ownerId: context.ownerId }),
	};

	return { port, registry, exchange, offers };
}
