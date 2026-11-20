import type { PersonStore } from "./ports";

export type FindPersonContactPorts = {
	personStore: Pick<PersonStore, "contact">;
};

/** Which Person. */
export type FindPersonContact = { personId: string };

/** The name and email of a Person, or null for one this Replica does not know. */
export const findPersonContact =
	(ports: FindPersonContactPorts) =>
	async (
		request: FindPersonContact,
	): Promise<{ name: string; email: string } | null> =>
		ports.personStore.contact(request.personId);
