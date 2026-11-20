import type { Role } from "../../../roles";
import type { MemberStore } from "../../application/ports";
import { type MembersRecords, membersRecords } from "./in-memory-person-store";

/** `MemberStore` in memory, over the memberships of `records`. */
export function inMemoryMemberStore(
	records: MembersRecords = membersRecords(),
) {
	let added = 0;
	const withPerson = (spaceId: string) =>
		records.members.flatMap((m) => {
			const person = records.persons.find((p) => p.id === m.personId);
			return m.spaceId === spaceId && person ? [{ m, person }] : [];
		});
	const twin = {
		records,
		async membersOf(spaceId: string) {
			return withPerson(spaceId)
				.sort((a, b) => a.m.createdAt - b.m.createdAt)
				.map(({ m, person }) => ({
					id: m.id,
					personId: m.personId,
					name: person.name,
					email: person.email,
					role: m.role as Role,
					joinedAt: m.createdAt,
				}));
		},
		async roster(spaceId: string) {
			return withPerson(spaceId).map(({ m, person }) => ({
				id: person.id,
				name: person.name,
				role: m.role,
			}));
		},
		async membershipOf(spaceId: string, personId: string) {
			const found = records.members.find(
				(m) => m.spaceId === spaceId && m.personId === personId,
			);
			return found ? { id: found.id, role: found.role } : null;
		},
		async add(membership: {
			id: string;
			spaceId: string;
			personId: string;
			role: string;
		}) {
			const last = Math.max(0, ...records.members.map((m) => m.createdAt));
			records.members.push({ ...membership, createdAt: last + ++added });
		},
		async setRole(membershipId: string, role: string) {
			const found = records.members.find((m) => m.id === membershipId);
			if (found) found.role = role;
		},
		async remove(spaceIds: readonly string[], personId: string) {
			records.members = records.members.filter(
				(m) => !(spaceIds.includes(m.spaceId) && m.personId === personId),
			);
		},
	};
	return twin satisfies MemberStore;
}

export type InMemoryMemberStore = ReturnType<typeof inMemoryMemberStore>;
