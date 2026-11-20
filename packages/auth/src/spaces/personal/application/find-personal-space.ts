import type { PersonalSpaceStore } from "./ports";

export type FindPersonalSpacePorts = {
	personalSpaceStore: Pick<PersonalSpaceStore, "personalSpaceId">;
};

/** Whose personal Space. */
export type FindPersonalSpace = { personId: string };

/** The id of the Person's personal Space, or null. */
export const findPersonalSpace =
	(ports: FindPersonalSpacePorts) =>
	async (request: FindPersonalSpace): Promise<string | null> =>
		ports.personalSpaceStore.personalSpaceId(request.personId);
