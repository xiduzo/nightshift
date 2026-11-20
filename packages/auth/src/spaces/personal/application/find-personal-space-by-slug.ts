import { personalSlug } from "../domain/personal-space";
import type { PersonalSpaceStore } from "./ports";

export type FindPersonalSpaceBySlugPorts = {
	personalSpaceStore: Pick<PersonalSpaceStore, "spaceIdBySlug">;
};

/** Whose personal Space. */
export type FindPersonalSpaceBySlug = { personId: string };

/**
 * The id of the Person's personal Space by its slug (`personal-<user id>`),
 * or null. Unlike `findPersonalSpace`, it needs no membership row: a Host
 * finds the personal Space of a Device's owner this way.
 */
export const findPersonalSpaceBySlug =
	(ports: FindPersonalSpaceBySlugPorts) =>
	async (request: FindPersonalSpaceBySlug): Promise<string | null> =>
		ports.personalSpaceStore.spaceIdBySlug(personalSlug(request.personId));
