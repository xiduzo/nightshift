import { type Permissions, roleAllows } from "@nightshift/auth";
import type { PersonActor } from "../../../contract";
import type { MemberSpaces } from "../../application/ports";

/**
 * The Spaces of Persons in memory, with the roles of `@nightshift/auth`
 * (`roleAllows`). A test adds a Space (`space`) and a Member (`join`). It
 * records who asked (`asked`).
 */
export function inMemoryMemberSpaces() {
	const spaces = new Map<
		string,
		{ name: string; roles: Map<string, string> }
	>();

	const twin = {
		/** Every Person whose Spaces were read, in order. */
		asked: [] as string[],
		/** A Space of that id and name. */
		space(id: string, name = id) {
			spaces.set(id, { name, roles: spaces.get(id)?.roles ?? new Map() });
		},
		/** Makes the Person a Member of the Space with `role`. */
		join(spaceId: string, personId: string, role: string) {
			const space = spaces.get(spaceId);
			if (!space) throw new Error(`No Space ${spaceId} in this test.`);
			space.roles.set(personId, role);
		},

		async of(person: PersonActor, need: Permissions) {
			twin.asked.push(person.personId);
			const found: { id: string; name: string; allowed: boolean }[] = [];
			for (const [id, space] of spaces) {
				const role = space.roles.get(person.personId);
				if (!role) continue;
				found.push({
					id,
					name: space.name,
					allowed: Object.keys(need).length === 0 || roleAllows(role, need),
				});
			}
			return found;
		},
	};
	return twin satisfies MemberSpaces;
}

export type InMemoryMemberSpaces = ReturnType<typeof inMemoryMemberSpaces>;
