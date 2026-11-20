import { drizzleMembersSeed, memoryDb } from "../../test-support";
import { drizzleMemberStore } from "./drizzle-member-store";
import { inMemoryMemberStore } from "./in-memory-member-store";
import { membersRecords, seedRecords } from "./in-memory-person-store";
import { memberStoreContract } from "./member-store.contract";

/** The contract of `MemberStore`, on both adapters. The real one runs on libsql in memory. */

memberStoreContract("in memory", async () => {
	const records = membersRecords();
	return {
		memberStore: inMemoryMemberStore(records),
		seed: seedRecords(records),
		close: async () => {},
	};
});

memberStoreContract("over drizzle", async () => {
	const db = await memoryDb();
	return {
		memberStore: drizzleMemberStore(db),
		seed: drizzleMembersSeed(db),
		close: async () => {},
	};
});
