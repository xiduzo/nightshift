import { migratedDb } from "@nightshift/db/testing";
import { openDeviceDocument } from "../../../../documents";
import { inMemorySavedSettings } from "./in-memory-saved-settings";
import { savedSettingsContract } from "./saved-settings.contract";
import { yjsSavedSettings } from "./yjs-saved-settings";

/**
 * The contract of `SavedSettings`, on both adapters. The real side runs
 * on libsql in memory: the Device document of a migrated database.
 */

savedSettingsContract("in memory", async () => ({
	saved: inMemorySavedSettings(),
	close: async () => {},
}));

savedSettingsContract("the Device document, on libsql in memory", async () => {
	const db = await migratedDb();
	const document = await openDeviceDocument({ db, deviceId: "device-1" });
	return { saved: yjsSavedSettings(document), close: async () => {} };
});
