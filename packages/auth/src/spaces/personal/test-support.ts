import type { Database } from "@nightshift/db";
import { member, organization, user } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { drizzleLocalPersonStore } from "./adapters/out/drizzle-local-person-store";
import { drizzlePersonalSpaceStore } from "./adapters/out/drizzle-personal-space-store";
import type { RowBatch } from "./domain/personal-space";

/**
 * The ports of personal over a database in memory, the rows a test puts on
 * it, and how a row batch runs on it.
 */

/** What a test puts on a Replica before it asks a store. */
export type PersonalSeed = {
	person(person: {
		id: string;
		name: string;
		email: string;
		role?: string;
	}): Promise<void>;
	space(space: {
		id: string;
		name: string;
		slug: string;
		personal: boolean;
	}): Promise<void>;
	membership(membership: {
		id: string;
		spaceId: string;
		personId: string;
		role: string;
	}): Promise<void>;
};

/**
 * A migrated database in memory, without the local Person and the
 * personal Space that the migrations make: an empty Replica.
 */
export async function memoryDb(): Promise<Database> {
	const db = await migratedDb();
	await db.delete(member);
	await db.delete(organization);
	await db.delete(user);
	return db;
}

/** Puts rows on the database. */
export function drizzlePersonalSeed(db: Database): PersonalSeed {
	return {
		async person(person) {
			await db.insert(user).values(person);
		},
		async space(space) {
			await db.insert(organization).values({ ...space, createdAt: asDate(0) });
		},
		async membership(row) {
			await db.insert(member).values({
				id: row.id,
				organizationId: row.spaceId,
				userId: row.personId,
				role: row.role,
				createdAt: asDate(0),
			});
		},
	};
}

/** Runs a row batch of the drizzle adapter as one `db.batch`. */
export async function runBatch(db: Database, rows: RowBatch): Promise<void> {
	await db.batch(rows as unknown as Parameters<Database["batch"]>[0]);
}

/**
 * Every port of the slice: the stores over one database in memory, and the
 * two use cases of other slices it calls, which record what they were asked.
 */
export async function personalPorts() {
	const db = await memoryDb();
	const claimed: string[] = [];
	let ids = 0;
	return {
		...drizzlePersonalSeed(db),
		run: (rows: RowBatch) => runBatch(db, rows),
		/** The rows of this Replica, as a test compares them. */
		persons: () =>
			db
				.select({
					id: user.id,
					name: user.name,
					email: user.email,
					role: user.role,
				})
				.from(user),
		spaces: () =>
			db
				.select({
					id: organization.id,
					name: organization.name,
					slug: organization.slug,
					personal: organization.personal,
				})
				.from(organization)
				.orderBy(organization.id),
		members: () =>
			db
				.select({
					id: member.id,
					spaceId: member.organizationId,
					personId: member.userId,
					role: member.role,
				})
				.from(member),
		/** The Persons `claimHostAdmin` was asked for, in order. */
		claimed,
		newId: () => `id-${++ids}`,
		accountName: () => "ada",
		claimHostAdmin: async (request: { personId: string }) => {
			claimed.push(request.personId);
		},
		personalSpaceStore: drizzlePersonalSpaceStore(db),
		localPersonStore: drizzleLocalPersonStore(db),
	};
}
