import type { DeviceCopies } from "@nightshift/engine/device-config";
import type { DevicesDeps } from "./devices-runtime";
import type { DeviceKeyStore, DeviceLinks, HostLinks } from "./links";
import { createHomeMembership, type HomeMembership } from "./membership";
import type { PeerEngine } from "./wire-peers-engine";

/**
 * The membership block of the devices runtime (`startDevices`): this
 * computer's membership of its home Host (ADR 1), the merge of its
 * Personal into the Host's, and the split when it leaves.
 */
export function wireMembership(
	deps: Pick<
		DevicesDeps,
		"db" | "spaces" | "flows" | "self" | "ownerId" | "dataDir"
	>,
	engine: PeerEngine,
	at: {
		links: DeviceLinks;
		hostLinks: HostLinks;
		keys: DeviceKeyStore;
		copies: DeviceCopies;
	},
): { membership: HomeMembership; finishing: AbortController } {
	const membership = createHomeMembership({
		db: deps.db,
		engine,
		links: at.links,
		hostLinks: at.hostLinks,
		keys: at.keys,
		copies: at.copies,
		spaces: deps.spaces,
		flows: deps.flows,
		self: deps.self,
		ownerId: deps.ownerId,
		dataDir: deps.dataDir,
	});
	// A merge that moved its rows finishes when its Host answers. A split
	// starts once this computer left its Host, and finishes by itself.
	const finishing = new AbortController();
	membership.keepFinishing(finishing.signal);
	return { membership, finishing };
}
