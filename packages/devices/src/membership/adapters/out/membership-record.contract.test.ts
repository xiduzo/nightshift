import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { drizzleMembershipRecord } from "./drizzle-membership-record";
import { inMemoryMembershipRecord } from "./in-memory-membership-record";
import { membershipRecordContract } from "./membership-record.contract";

membershipRecordContract("in memory", () => inMemoryMembershipRecord());

membershipRecordContract("drizzle", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	return drizzleMembershipRecord(db);
});
