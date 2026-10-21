/**
 * Test helpers of `@nightshift/devices`: the engine's test options
 * (`withDevice`), with the peers' own beside them.
 */
import { type TestEngineOptions, withDevice } from "@nightshift/engine/testing";
import type { createPeerEngine } from "../peers";

type PeerEngineOptions = Parameters<typeof createPeerEngine>[0];

/** A test engine's options for `createPeerEngine`: `withDevice`, and the peers' options. */
export function withPeers(
	options: Omit<TestEngineOptions, "peers" | "relay"> &
		Pick<PeerEngineOptions, "work" | "ownOffers" | "mayUseOffers" | "relay">,
): PeerEngineOptions {
	const { work, ownOffers, mayUseOffers, relay, ...engine } = options;
	const { peers: _alone, relay: _none, ...rest } = withDevice(engine);
	return {
		...rest,
		...(relay ? { relay } : {}),
		...(work ? { work } : {}),
		...(ownOffers ? { ownOffers } : {}),
		...(mayUseOffers ? { mayUseOffers } : {}),
	};
}
