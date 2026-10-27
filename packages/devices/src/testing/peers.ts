import { type TestEngineOptions, withDevice } from "@nightshift/engine/testing";
import type { createPeerEngine } from "../peers";

type PeerEngineOptions = Parameters<typeof createPeerEngine>[0];

/** A test engine's options for `createPeerEngine`: `withDevice`, and the peers' options. */
export function withPeers(
	options: Omit<TestEngineOptions, "peers"> &
		Pick<
			PeerEngineOptions,
			"work" | "ownOffers" | "ownProfiles" | "mayUseOffers" | "relay"
		>,
): PeerEngineOptions {
	const { work, ownOffers, ownProfiles, mayUseOffers, relay, ...engine } =
		options;
	const { peers: _alone, ...rest } = withDevice(engine);
	return {
		...rest,
		...(relay ? { relay } : {}),
		...(work ? { work } : {}),
		...(ownOffers ? { ownOffers } : {}),
		...(ownProfiles ? { ownProfiles } : {}),
		...(mayUseOffers ? { mayUseOffers } : {}),
	};
}
