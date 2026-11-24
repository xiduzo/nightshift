import { migratedDb } from "@nightshift/db/testing";
import {
	createSyncedDocuments,
	documentName,
	openDeviceDocument,
} from "../../../../documents";
import { deviceDocumentsContract } from "./device-documents.contract";
import { drizzleDeviceDocuments } from "./drizzle-device-documents";
import { inMemoryDeviceDocuments } from "./in-memory-device-documents";

/**
 * The contract of `DeviceDocuments`, on both adapters. The real side runs
 * on libsql in memory: the `ydoc` rows of a migrated database.
 */

const record = (deviceId: string, name: string) => ({
	copy: {
		deviceId,
		name,
		platform: null,
		profiles: [],
		secrets: [],
		checkedAt: null,
	},
	profiles: [],
});

deviceDocumentsContract("in memory", async () => {
	const documents = inMemoryDeviceDocuments();
	return {
		documents,
		writeKept: async (deviceId, name) => documents.keep(record(deviceId, name)),
		writeCopy: async (deviceId, name) => documents.sync(record(deviceId, name)),
		close: async () => {},
	};
});

deviceDocumentsContract("the ydoc rows, on libsql in memory", async () => {
	const db = await migratedDb();
	const synced = createSyncedDocuments({ db });
	return {
		documents: drizzleDeviceDocuments({ db, documents: synced }),
		async writeKept(deviceId, name) {
			const document = await openDeviceDocument({ db, deviceId });
			await document.change(() => {
				document.facts.set("name", name);
			});
		},
		async writeCopy(deviceId, name) {
			const copy = await synced.open(documentName("device-copy", deviceId));
			await copy.change(() => {
				copy.doc.getMap("facts").set("name", name);
			});
		},
		close: () => synced.close(),
	};
});
