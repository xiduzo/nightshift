import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { openDeviceDocument } from "@nightshift/engine";
import { deviceOffersContract } from "./device-offers.contract";
import { inMemoryDeviceOffers } from "./in-memory-device-offers";
import { yjsDeviceOffers } from "./yjs-device-offers";

/** The contract of `DeviceOffers`, on both adapters. The real one runs on a Device document in memory. */

deviceOffersContract("in memory", () => inMemoryDeviceOffers());

deviceOffersContract("over the Device document", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const document = await openDeviceDocument({ db, deviceId: "self" });
	return yjsDeviceOffers(document);
});
