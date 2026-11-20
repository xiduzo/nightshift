import type { SpaceStore } from "./ports";

export type MirrorHostSpacePorts = {
	spaceStore: Pick<SpaceStore, "mirror">;
};

/** The Space the Host lists: its id and its name there. */
export type MirrorHostSpace = { id: string; name: string };

/**
 * Keeps a Space that a Host lists as this Replica's copy: makes its row
 * (slug `host-<id>`), or gives the row the Host's name.
 */
export const mirrorHostSpace =
	(ports: MirrorHostSpacePorts) =>
	async (request: MirrorHostSpace): Promise<void> => {
		await ports.spaceStore.mirror(request);
	};
