import type { Role } from "../roles";
import type { SpaceStore } from "./ports";

export type FindRolePorts = {
	spaceStore: Pick<SpaceStore, "roleOf">;
};

/** Whose role, in which Space. */
export type FindRole = { personId: string; spaceId: string };

/** The Person's role in the Space, or null when they are not a member. */
export const findRole =
	(ports: FindRolePorts) =>
	async (request: FindRole): Promise<Role | null> =>
		ports.spaceStore.roleOf(request.personId, request.spaceId);
