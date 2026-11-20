import type { PersonStore } from "../../application/ports";

/**
 * The rows the in-memory adapters of members share, as one Replica holds
 * them: its Persons, its Spaces, their memberships and invitations. A
 * time is an instant. A row that comes later has a later `createdAt`.
 */
export type MembersRecords = {
	persons: { id: string; name: string; email: string; role: string | null }[];
	spaces: { id: string; name: string }[];
	members: {
		id: string;
		spaceId: string;
		personId: string;
		role: string;
		createdAt: number;
	}[];
	invitations: {
		id: string;
		spaceId: string;
		email: string;
		role: string | null;
		status: string;
		expiresAt: number;
		inviterId: string;
		createdAt: number;
	}[];
};

/** What a test puts on a Replica before it asks a store. */
export type MembersSeed = {
	person(person: {
		id: string;
		name: string;
		email: string;
		role?: string | null;
	}): Promise<void>;
	space(space: { id: string; name: string }): Promise<void>;
	membership(membership: {
		id: string;
		spaceId: string;
		personId: string;
		role: string;
		createdAt: number;
	}): Promise<void>;
	invitation(invitation: MembersRecords["invitations"][number]): Promise<void>;
};

/** An empty Replica. */
export function membersRecords(): MembersRecords {
	return { persons: [], spaces: [], members: [], invitations: [] };
}

/** Puts rows on the in-memory Replica. */
export function seedRecords(records: MembersRecords): MembersSeed {
	return {
		async person(person) {
			records.persons.push({ role: null, ...person });
		},
		async space(space) {
			records.spaces.push(space);
		},
		async membership(membership) {
			records.members.push(membership);
		},
		async invitation(invitation) {
			records.invitations.push(invitation);
		},
	};
}

/** `PersonStore` in memory, over the Persons of `records`. */
export function inMemoryPersonStore(records = membersRecords()) {
	const person = (id: string) => records.persons.find((p) => p.id === id);
	const twin = {
		records,
		async hasAnyone() {
			return records.persons.length > 0;
		},
		async hasRole(role: string) {
			return records.persons.some((p) => p.role === role);
		},
		async roleOf(personId: string) {
			return person(personId)?.role ?? null;
		},
		async setRole(personId: string, role: string) {
			const found = person(personId);
			if (found) found.role = role;
		},
		async hasAccount(email: string) {
			return records.persons.some((p) => p.email.toLowerCase() === email);
		},
		async names(ids: readonly string[]) {
			return new Map(
				records.persons
					.filter((p) => ids.includes(p.id))
					.map((p) => [p.id, p.name]),
			);
		},
		async contact(personId: string) {
			const found = person(personId);
			return found ? { name: found.name, email: found.email } : null;
		},
	};
	return twin satisfies PersonStore;
}

export type InMemoryPersonStore = ReturnType<typeof inMemoryPersonStore>;
