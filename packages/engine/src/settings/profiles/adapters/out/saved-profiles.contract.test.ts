import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { openDeviceDocument } from "../../../../documents";
import { inMemorySavedProfiles } from "./in-memory-saved-profiles";
import { savedProfilesContract } from "./saved-profiles.contract";
import { yjsSavedProfiles } from "./yjs-saved-profiles";

/**
 * The contract of `SavedProfiles`, on both adapters. The real side runs
 * on libsql in memory: the Device document of a migrated database.
 */

savedProfilesContract("in memory", async () => {
	const saved = inMemorySavedProfiles();
	return {
		saved,
		put: async (id, value) => saved.put(id, value),
		close: async () => {},
	};
});

savedProfilesContract("the Device document, on libsql in memory", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const document = await openDeviceDocument({ db, deviceId: "device-1" });
	return {
		saved: yjsSavedProfiles(document),
		put: (id, value) =>
			document.change(() => {
				document.profiles.set(id, value);
			}),
		close: async () => {},
	};
});
