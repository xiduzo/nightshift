import { migratedDb } from "@nightshift/db/testing";
import { drizzleMembershipRecord } from "./drizzle-membership-record";
import { inMemoryMembershipRecord } from "./in-memory-membership-record";
import { membershipRecordContract } from "./membership-record.contract";

membershipRecordContract("in memory", () => inMemoryMembershipRecord());

membershipRecordContract("drizzle", async () => {
	const db = await migratedDb();
	return drizzleMembershipRecord(db);
});
