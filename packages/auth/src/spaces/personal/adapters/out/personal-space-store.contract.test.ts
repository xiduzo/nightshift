import { drizzlePersonalSeed, memoryDb, runBatch } from "../../test-support";
import { drizzlePersonalSpaceStore } from "./drizzle-personal-space-store";
import {
	applyRows,
	inMemoryPersonalSpaceStore,
	personalRecords,
} from "./in-memory-personal-space-store";
import { personalSpaceStoreContract } from "./personal-space-store.contract";

/** The contract of `PersonalSpaceStore`, on both adapters. The real one runs on libsql in memory. */

personalSpaceStoreContract("in memory", async () => {
	const records = personalRecords();
	return {
		personalSpaceStore: inMemoryPersonalSpaceStore(records),
		seed: {
			person: async (person) => {
				records.persons.push({ ...person, role: "user" });
			},
			space: async (space) => {
				records.spaces.push(space);
			},
			membership: async (membership) => {
				records.members.push(membership);
			},
		},
		run: async (rows) => applyRows(records, rows),
		close: async () => {},
	};
});

personalSpaceStoreContract("over drizzle", async () => {
	const db = await memoryDb();
	return {
		personalSpaceStore: drizzlePersonalSpaceStore(db),
		seed: drizzlePersonalSeed(db),
		run: (rows) => runBatch(db, rows),
		close: async () => {},
	};
});
