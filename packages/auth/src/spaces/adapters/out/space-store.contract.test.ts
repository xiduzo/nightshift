import { member, organization, user } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { sql } from "drizzle-orm";
import { drizzleSpaceStore } from "./drizzle-space-store";
import { inMemorySpaceStore } from "./in-memory-space-store";
import { spaceStoreContract } from "./space-store.contract";

/** The contract of `SpaceStore`, on both adapters. The real one runs on libsql in memory. */

spaceStoreContract("in memory", async () => {
	const spaceStore = inMemorySpaceStore();
	const { records } = spaceStore;
	return {
		spaceStore,
		seed: {
			person: async () => {},
			space: async (space) => {
				records.spaces.push({ ...space, slug: space.id });
			},
			membership: async (row) => {
				records.members.push(row);
			},
			orphanMembership: async (row) => {
				records.members.push(row);
			},
		},
		close: async () => {},
	};
});

spaceStoreContract("over drizzle", async () => {
	const db = await migratedDb();
	// An empty Replica: without the local Person and the Space the migrations make.
	await db.delete(member);
	await db.delete(organization);
	await db.delete(user);
	let memberships = 0;
	const membership = async (row: {
		spaceId: string;
		personId: string;
		role: string;
	}) => {
		await db.insert(member).values({
			id: `m-${++memberships}`,
			organizationId: row.spaceId,
			userId: row.personId,
			role: row.role,
			createdAt: asDate(0),
		});
	};
	return {
		spaceStore: drizzleSpaceStore(db),
		seed: {
			person: async (id) => {
				await db.insert(user).values({ id, name: id, email: `${id}@x.org` });
			},
			space: async (space) => {
				await db
					.insert(organization)
					.values({ ...space, slug: space.id, createdAt: asDate(0) });
			},
			membership,
			orphanMembership: async (row) => {
				await db.run(sql`PRAGMA foreign_keys = OFF`);
				await membership(row);
				await db.run(sql`PRAGMA foreign_keys = ON`);
			},
		},
		close: async () => {},
	};
});
