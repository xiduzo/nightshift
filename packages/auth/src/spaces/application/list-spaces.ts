import type { Role } from "../roles";
import type { SpaceStore } from "./ports";

/**
 * A Space as the organization plugin stores it (an organization), with the
 * role of the Person in it.
 */
export type Space = {
	id: string;
	name: string;
	personal: boolean;
	role: Role;
};

export type ListSpacesPorts = {
	spaceStore: Pick<SpaceStore, "spacesOf">;
};

/** Whose Spaces. */
export type ListSpaces = { personId: string };

/** The Spaces the Person is a member of, the personal one first, then by name. */
export const listSpaces =
	(ports: ListSpacesPorts) =>
	async (request: ListSpaces): Promise<Space[]> =>
		ports.spaceStore.spacesOf(request.personId);
