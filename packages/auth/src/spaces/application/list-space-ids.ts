import type { SpaceStore } from "./ports";

export type ListSpaceIdsPorts = {
	spaceStore: Pick<SpaceStore, "ids">;
};

/** The id of every Space on this Replica. */
export const listSpaceIds =
	(ports: ListSpaceIdsPorts) => async (): Promise<string[]> =>
		ports.spaceStore.ids();
