import type { PersonStore } from "./ports";

export type ListPersonNamesPorts = {
	personStore: Pick<PersonStore, "names">;
};

/** Which Persons. */
export type ListPersonNames = { ids: readonly string[] };

/** The names of these Persons, by id. A Person this Replica does not know is missing. */
export const listPersonNames =
	(ports: ListPersonNamesPorts) =>
	async (request: ListPersonNames): Promise<Map<string, string>> => {
		if (request.ids.length === 0) return new Map();
		return ports.personStore.names(request.ids);
	};
