import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { openDeviceDocument } from "../../../../documents";
import { inMemorySavedCliTools } from "./in-memory-saved-cli-tools";
import { savedCliToolsContract } from "./saved-cli-tools.contract";
import { yjsSavedCliTools } from "./yjs-saved-cli-tools";

/**
 * The contract of `SavedCliTools`, on both adapters. The real side runs
 * on libsql in memory: the Device document of a migrated database.
 */

savedCliToolsContract("in memory", async () => {
	const saved = inMemorySavedCliTools();
	return {
		saved,
		put: async (name, value) => saved.put(name, value),
		close: async () => {},
	};
});

savedCliToolsContract("the Device document, on libsql in memory", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const document = await openDeviceDocument({ db, deviceId: "device-1" });
	return {
		saved: yjsSavedCliTools(document),
		put: (name, value) =>
			document.change(() => {
				document.cliTools.set(name, value);
			}),
		close: async () => {},
	};
});
