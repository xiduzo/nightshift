import type { SpaceStore } from "./ports";

export type FindActiveSpacePorts = {
	spaceStore: Pick<SpaceStore, "roleOf">;
	/** The Person's personal Space, made when there is none (`ensurePersonalSpace` of personal). */
	ensurePersonalSpace: (request: { personId: string }) => Promise<string>;
};

/** The Person of a session, and the Space the session last worked in. */
export type FindActiveSpace = {
	personId: string;
	activeSpaceId?: string | null;
};

/**
 * The Space a session works in: its active Space when the Person is still
 * a member of it, else their personal Space.
 */
export const findActiveSpace =
	(ports: FindActiveSpacePorts) =>
	async (request: FindActiveSpace): Promise<string> => {
		const { personId, activeSpaceId: active } = request;
		if (active && (await ports.spaceStore.roleOf(personId, active))) {
			return active;
		}
		return ports.ensurePersonalSpace({ personId });
	};
