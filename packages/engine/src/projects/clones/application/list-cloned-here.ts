import type { ProjectStore } from "../../keep";

export type ListClonedHerePorts = {
	store: Pick<ProjectStore, "here">;
};

/** The Space. */
export type ListClonedHere = { spaceId: string };

/**
 * The projects of the Space with a Clone on this computer, removed ones
 * too: what this Device tells the Host that keeps the Space it has, so a
 * Clone the Host missed heals.
 */
export const listClonedHere =
	(ports: ListClonedHerePorts) =>
	async (request: ListClonedHere): Promise<string[]> => {
		const rows = await ports.store.here({ spaceId: request.spaceId });
		return rows.map((row) => row.id);
	};
