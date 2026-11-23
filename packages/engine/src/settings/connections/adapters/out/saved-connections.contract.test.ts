import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { openDeviceDocument } from "../../../../documents";
import { inMemorySavedConnections } from "./in-memory-saved-connections";
import { savedConnectionsContract } from "./saved-connections.contract";
import { yjsSavedConnections } from "./yjs-saved-connections";

/**
 * The contract of `SavedConnections`, on both adapters. The real side
 * runs on libsql in memory: the Device document of a migrated database.
 */

savedConnectionsContract("in memory", async () => {
	const saved = inMemorySavedConnections();
	return {
		saved,
		put: async (name, value) => saved.put(name, value),
		close: async () => {},
	};
});

savedConnectionsContract(
	"the Device document, on libsql in memory",
	async () => {
		const db = createDb({ DATABASE_URL: ":memory:" });
		await migrateDb(db);
		const document = await openDeviceDocument({ db, deviceId: "device-1" });
		return {
			saved: yjsSavedConnections(document),
			put: (name, value) =>
				document.change(() => {
					document.connections.set(name, value);
				}),
			close: async () => {},
		};
	},
);
