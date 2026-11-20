import type { LocalPersonStore } from "../../application/ports";
import {
	type PersonalRecords,
	personalRecords,
} from "./in-memory-personal-space-store";

/** `LocalPersonStore` in memory, over the Persons of `records`. */
export function inMemoryLocalPersonStore(
	records: PersonalRecords = personalRecords(),
) {
	const found = (person?: { id: string; name: string }) =>
		person ? { id: person.id, name: person.name } : null;
	const twin = {
		records,
		async find(personId: string) {
			return found(records.persons.find((p) => p.id === personId));
		},
		async findByEmail(email: string) {
			return found(records.persons.find((p) => p.email === email));
		},
		async add(person: {
			id: string;
			name: string;
			email: string;
			role: string;
		}) {
			records.persons.push({ ...person });
		},
		async rename(personId: string, name: string) {
			const person = records.persons.find((p) => p.id === personId);
			if (person) person.name = name;
		},
	};
	return twin satisfies LocalPersonStore;
}

export type InMemoryLocalPersonStore = ReturnType<
	typeof inMemoryLocalPersonStore
>;
