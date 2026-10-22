import {
	createEngine,
	type Engine,
	type EngineOptions,
} from "@nightshift/engine";
import type { EngineExchange } from "../exchange";
import type { EngineOffers } from "../offers";
import type { DeviceRegistry } from "../registry";
import { deviceDirectory } from "./directory";
import { type BuiltPeers, createPeers, type PeerOptions } from "./peers";

/** The engine of this Device among its peers, with the devices' half beside it. */
export type PeerEngine = Engine & {
	/** Run history between this Replica and others: rows, cursors, commands, the archive. */
	readonly exchange: EngineExchange;
	/**
	 * On a Host: the Devices that paired with it, their presence and the
	 * audit of it. Each Person sees their own Devices only (the API's rule).
	 */
	readonly devices: DeviceRegistry;
	/** The Offers of the Spaces: published in their documents, with their audit. */
	readonly offers: EngineOffers;
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
	const { work, ownOffers, mayUseOffers, relay, ...engineOptions } = options;
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
					...(mayUseOffers ? { mayUseOffers } : {}),
				});
				return built.port;
			},
		},
		internals,
	);
	if (!built) throw new Error("The engine did not make its peers.");
	return {
		...engine,
		exchange: built.exchange,
		devices: built.registry,
		offers: built.offers,
	};
}
