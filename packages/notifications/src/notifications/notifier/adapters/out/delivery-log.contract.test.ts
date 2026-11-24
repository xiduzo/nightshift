import { migratedDb } from "@nightshift/db/testing";
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
	const db = await migratedDb();
	return { deliveryLog: drizzleDeliveryLog(db), close: async () => {} };
});
