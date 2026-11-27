import type { Database } from "@nightshift/db";
import { invitation, member, organization, user } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { memoryDb } from "../../testing/memory-db";
import { drizzleInvitationStore } from "./adapters/out/drizzle-invitation-store";
import { drizzleMemberStore } from "./adapters/out/drizzle-member-store";
import { drizzlePersonStore } from "./adapters/out/drizzle-person-store";

/**
 * The ports of members over a database in memory, and the rows a test puts
 * on it before it asks a store.
 */

/** What a test puts on a Replica before it asks a store. A time is an instant. */
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
	invitation(invitation: {
		id: string;
		spaceId: string;
		email: string;
		role: string | null;
		status: string;
		expiresAt: number;
		inviterId: string;
		createdAt: number;
	}): Promise<void>;
};

/** Puts rows on the database. */
export function drizzleMembersSeed(db: Database): MembersSeed {
	return {
		async person(person) {
			await db.insert(user).values({
				id: person.id,
				name: person.name,
				email: person.email,
				role: person.role ?? null,
			});
		},
		async space(space) {
			await db.insert(organization).values({
				id: space.id,
				name: space.name,
				slug: space.id,
				createdAt: asDate(0),
			});
		},
		async membership(row) {
			await db.insert(member).values({
				id: row.id,
				organizationId: row.spaceId,
				userId: row.personId,
				role: row.role,
				createdAt: asDate(row.createdAt),
			});
		},
		async invitation(row) {
			await db.insert(invitation).values({
				id: row.id,
				organizationId: row.spaceId,
				email: row.email,
				role: row.role,
				status: row.status,
				expiresAt: asDate(row.expiresAt),
				inviterId: row.inviterId,
				createdAt: asDate(row.createdAt),
			});
		},
	};
}

/** Every port of members over one database: where each use-case test starts. */
export async function membersPorts() {
	const db = await memoryDb();
	let ids = 0;
	return {
		seed: drizzleMembersSeed(db),
		newId: () => `id-${++ids}`,
		personStore: drizzlePersonStore(db),
		invitationStore: drizzleInvitationStore(db),
		memberStore: drizzleMemberStore(db),
	};
}
