import { personalSlug, personalSpaceName } from "../domain/personal-space";
import type { PersonalSpaceStore } from "./ports";

export type EnsurePersonalSpacePorts = {
	personalSpaceStore: Pick<PersonalSpaceStore, "personalSpaceId" | "create">;
	/** A new id: first the Space's, then the membership's. */
	newId: () => string;
};

/** Whose personal Space. */
export type EnsurePersonalSpace = { personId: string };

/** The Person's personal Space: made with its owner membership when there is none. */
export const ensurePersonalSpace =
	(ports: EnsurePersonalSpacePorts) =>
	async (request: EnsurePersonalSpace): Promise<string> => {
		const { personId } = request;
		const found = await ports.personalSpaceStore.personalSpaceId(personId);
		if (found) return found;
		const id = ports.newId();
		await ports.personalSpaceStore.create({
			id,
			name: personalSpaceName(),
			slug: personalSlug(personId),
			personId,
			membershipId: ports.newId(),
		});
		return id;
	};
