import { drizzleMembersSeed, memoryDb } from "../../test-support";
import { drizzleInvitationStore } from "./drizzle-invitation-store";
import { inMemoryInvitationStore } from "./in-memory-invitation-store";
import { membersRecords, seedRecords } from "./in-memory-person-store";
import { invitationStoreContract } from "./invitation-store.contract";

/** The contract of `InvitationStore`, on both adapters. The real one runs on libsql in memory. */

invitationStoreContract("in memory", async () => {
	const records = membersRecords();
	return {
		invitationStore: inMemoryInvitationStore(records),
		seed: seedRecords(records),
		close: async () => {},
	};
});

invitationStoreContract("over drizzle", async () => {
	const db = await memoryDb();
	return {
		invitationStore: drizzleInvitationStore(db),
		seed: drizzleMembersSeed(db),
		close: async () => {},
	};
});
