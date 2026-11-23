import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { deliveryLogContract } from "./delivery-log.contract";
import { drizzleDeliveryLog } from "./drizzle-delivery-log";
import { inMemoryDeliveryLog } from "./in-memory-delivery-log";

/**
 * The contract of `DeliveryLog`, on both adapters. The real adapter's side
 * runs on libsql in memory.
 */

deliveryLogContract("in memory", async () => ({
	deliveryLog: inMemoryDeliveryLog(),
	close: async () => {},
}));

deliveryLogContract("over drizzle", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	return { deliveryLog: drizzleDeliveryLog(db), close: async () => {} };
});
