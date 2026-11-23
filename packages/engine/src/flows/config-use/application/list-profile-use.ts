import type { ProfileView } from "../../../settings";
import {
	type FlowRef,
	flowUse,
	profileUseKey,
	readSpaceFlows,
} from "../domain/flow-use";
import type { Asker } from "../domain/secret-users";
import type { ConfiguredProfiles, SpaceViews, ThisDevice } from "./ports";

export type ListProfileUsePorts = {
	device: ThisDevice;
	spaces: SpaceViews;
	profiles: ConfiguredProfiles;
};

/** A profile of this computer, with the nodes that name it. */
export type ProfileInUse = ProfileView & {
	usedBy: (FlowRef & { nodeIds: string[] })[];
};

/**
 * This computer's profiles, with the nodes that name each in the Space of
 * the Person who asks. A flow names a profile of this computer with this
 * Device's id.
 */
export const listProfileUse =
	(ports: ListProfileUsePorts) =>
	async (request: { at: Asker }): Promise<ProfileInUse[]> => {
		const use = flowUse(await readSpaceFlows(ports.spaces.open(request.at)));
		return ports.profiles.list().map((p) => ({
			...p,
			usedBy: use.profiles.get(profileUseKey(ports.device.id, p.id)) ?? [],
		}));
	};
