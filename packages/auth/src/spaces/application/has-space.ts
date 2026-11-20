import type { SpaceStore } from "./ports";

export type HasSpacePorts = {
	spaceStore: Pick<SpaceStore, "exists">;
};

/** Which Space. */
export type HasSpace = { spaceId: string };

/** Whether a Space of that id exists on this Replica. */
export const hasSpace =
	(ports: HasSpacePorts) =>
	async (request: HasSpace): Promise<boolean> =>
		ports.spaceStore.exists(request.spaceId);
