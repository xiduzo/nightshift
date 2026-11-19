import type { DeviceDirectory, Relay } from "../../../../contract";
import type { SpaceKeeper } from "../../application/ports";

/** What the keeper of the start stands on: the Device directory, and the Hosts this computer reaches (`Peers.relay`). */
export type DirectorySpaceKeeperDeps = {
	directory: Pick<DeviceDirectory, "hostedElsewhere" | "hostOf">;
	/** Absent: this computer reaches no Host. */
	relay?: Pick<Relay, "reachable">;
};

/** Who keeps a Space, over the Device directory and the Links to its Host (`Relay.reachable`). */
export function directorySpaceKeeper(
	deps: DirectorySpaceKeeperDeps,
): SpaceKeeper {
	const { directory, relay } = deps;
	return {
		hostedElsewhere: (spaceId) => directory.hostedElsewhere(spaceId),
		reachable: async (spaceId) => (relay ? relay.reachable(spaceId) : false),
		hostOf: (spaceId) => directory.hostOf(spaceId),
	};
}
