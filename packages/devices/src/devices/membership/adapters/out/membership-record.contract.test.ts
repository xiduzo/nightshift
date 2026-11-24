import { migratedDb } from "@nightshift/db/testing";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzleMembershipRecord } from "./drizzle-membership-record";
import { inMemoryMembershipRecord } from "./in-memory-membership-record";
import { runInMemory } from "./in-memory-neighbours";
import { membershipRecordContract } from "./membership-record.contract";

membershipRecordContract("in memory", async () => ({
	record: inMemoryMembershipRecord(),
	run: async (batch) => runInMemory(batch),
}));

membershipRecordContract("drizzle", async () => {
	const db = await migratedDb();
	return {
		record: drizzleMembershipRecord(db),
		async run(batch) {
			const [first, ...rest] = batch as unknown as BatchItem<"sqlite">[];
			if (first) await db.batch([first, ...rest]);
		},
	};
});
