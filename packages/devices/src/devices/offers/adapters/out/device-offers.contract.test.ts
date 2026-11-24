import { migratedDb } from "@nightshift/db/testing";
import { openDeviceDocument } from "@nightshift/engine";
import { deviceOffersContract } from "./device-offers.contract";
import { inMemoryDeviceOffers } from "./in-memory-device-offers";
import { yjsDeviceOffers } from "./yjs-device-offers";

/** The contract of `DeviceOffers`, on both adapters. The real one runs on a Device document in memory. */

deviceOffersContract("in memory", () => inMemoryDeviceOffers());

deviceOffersContract("over the Device document", async () => {
	const db = await migratedDb();
	const document = await openDeviceDocument({ db, deviceId: "self" });
	return yjsDeviceOffers(document);
});
