import { type Permissions, RoleRefusal, roleAllows } from "@nightshift/auth";
import type { PersonActor } from "../../../../contract";
import type { SpaceMembers } from "../../application/ports";
import { inMemoryRunRecords } from "./in-memory-run-records";

/** Where a Member is written: the `member` rows of this Replica, or the Members of the Space document. */
export type MemberSource = "replica" | "document";

/**
 * The Members of Spaces in memory, with the roles of `@nightshift/auth`
 * (`roleAllows`). The rows of the Replica and the Space document are two
 * lists, so a test can make the doors differ. A test adds a Space
 * (`space`) and a Member (`join`).
 */
export function inMemorySpaceMembers() {
	const names = new Map<string, string>();
	const lists: Record<MemberSource, Map<string, Map<string, string>>> = {
		replica: new Map(),
		document: new Map(),
	};
	const allows = (role: string, need: Permissions) =>
		Object.keys(need).length === 0 || roleAllows(role, need);

	const twin = {
		/** A Space of that id and name. */
		space(id: string, name = id) {
			names.set(id, name);
		},
		/** Makes the Person a Member of the Space with `role`, in the rows, the document or both. */
		join(
			spaceId: string,
			personId: string,
			role: string,
			where: readonly MemberSource[] = ["replica", "document"],
		) {
			for (const source of where) {
				const members = lists[source].get(spaceId) ?? new Map();
				lists[source].set(spaceId, members);
				members.set(personId, role);
			}
		},

		async may(spaceId: string, person: PersonActor, need: Permissions) {
			const source = person.door === "command" ? "document" : "replica";
			const role = lists[source].get(spaceId)?.get(person.personId);
			if (!role) return "not-a-member" as const;
			return allows(role, need) ? ("yes" as const) : ("no" as const);
		},
		async spacesOf(person: PersonActor, need: Permissions) {
			const spaces: { id: string; name: string; allowed: boolean }[] = [];
			for (const [id, members] of lists.replica) {
				const role = members.get(person.personId);
				if (!role) continue;
				spaces.push({
					id,
					name: names.get(id) ?? id,
					allowed: allows(role, need),
				});
			}
			return spaces;
		},
	};
	return twin satisfies SpaceMembers;
}

export type InMemorySpaceMembers = ReturnType<typeof inMemorySpaceMembers>;

/**
 * Every port of access in memory at once, with the refusal of a role:
 * where each use-case test starts.
 */
export function inMemoryAccessPorts(walkerId?: string) {
	return {
		runs: inMemoryRunRecords(walkerId),
		members: inMemorySpaceMembers(),
		RoleRefusal,
	};
}
