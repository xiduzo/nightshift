import {
	createEngine,
	type Engine,
	type EngineOptions,
} from "@nightshift/engine";
import type { RunHistoryExchange } from "../exchange";
import type { HostSpaces } from "../links";
import type { EngineOffers, OfferAdmission } from "../offers";
import type { DeviceRegistry } from "../registry";
import { deviceDirectory } from "./directory";
import {
	type BuiltPeers,
	createPeers,
	type PeerOptions,
	type SpaceMembers,
} from "./peers";

/** The engine of this Device among its peers, with the devices' half beside it. */
export type PeerEngine = Engine & {
	/**
	 * Run history between this Replica and its Hosts: rows by cursor, the
	 * ingest and what follows from it, Commands, live transcripts, the
	 * archive files.
	 */
	readonly exchange: RunHistoryExchange;
	/** The Spaces the Hosts this computer links to keep (`host_space`). */
	readonly hostSpaces: HostSpaces;
	/** The Members of each Space, as its document mirrors them. */
	readonly members: SpaceMembers;
	/**
	 * On a Host: the Devices that paired with it, their presence and the
	 * audit of it. Each Person sees their own Devices only (the API's rule).
	 */
	readonly devices: DeviceRegistry;
	/** The Offers of the Spaces: published in their documents, with their audit. */
	readonly offers: EngineOffers;
	/**
	 * This computer's Offer admission: every check of a call of a run on
	 * this computer, walked here or sent by a Walker elsewhere, with one
	 * slot map per Offer. The work server and the Host's own steps serve
	 * through it.
	 */
	readonly admission: OfferAdmission;
};

/**
 * What `createPeerEngine` takes: the engine's options, with the peers' own.
 * The Device rows come from this package (`deviceDirectory`).
 */
export type PeerEngineOptions = Omit<EngineOptions, "peers" | "directory"> &
	PeerOptions;

/**
 * The engine of this Device (`createEngine`), wired to its peers
 * (`createPeers`): the daemon's one engine. `internals` are the engine's
 * test knobs.
 */
export function createPeerEngine(
	options: PeerEngineOptions,
	internals?: Parameters<typeof createEngine>[1],
): PeerEngine {
	const {
		work,
		ownOffers,
		ownProfiles,
		mayUseOffers,
		offerUse,
		presence,
		relay,
		...engineOptions
	} = options;
	let built: BuiltPeers | undefined;
	const engine = createEngine(
		{
			...engineOptions,
			directory: deviceDirectory(options.db),
			peers: (context) => {
				built = createPeers(context, {
					...(relay ? { relay } : {}),
					...(work ? { work } : {}),
					...(ownOffers ? { ownOffers } : {}),
					...(ownProfiles ? { ownProfiles } : {}),
					...(mayUseOffers ? { mayUseOffers } : {}),
					...(offerUse ? { offerUse } : {}),
					...(presence ? { presence } : {}),
				});
				return built.port;
			},
		},
		internals,
	);
	if (!built) throw new Error("The engine did not make its peers.");
	const { exchange } = built;
	return {
		...engine,
		// The runs that still arrive are this engine's no more.
		async dispose() {
			exchange.close();
			await engine.dispose();
		},
		exchange,
		hostSpaces: built.hostSpaces,
		members: built.members,
		devices: built.registry,
		offers: built.offers,
		admission: built.admission,
	};
}
