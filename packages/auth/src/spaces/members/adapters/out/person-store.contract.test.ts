import { drizzleMembersSeed, memoryDb } from "../../test-support";
import { drizzlePersonStore } from "./drizzle-person-store";
import {
	inMemoryPersonStore,
	membersRecords,
	seedRecords,
} from "./in-memory-person-store";
import { personStoreContract } from "./person-store.contract";

/** The contract of `PersonStore`, on both adapters. The real one runs on libsql in memory. */

personStoreContract("in memory", async () => {
	const records = membersRecords();
	return {
		personStore: inMemoryPersonStore(records),
		seed: seedRecords(records),
		close: async () => {},
	};
});

personStoreContract("over drizzle", async () => {
	const db = await memoryDb();
	return {
		personStore: drizzlePersonStore(db),
		seed: drizzleMembersSeed(db),
		close: async () => {},
	};
});
