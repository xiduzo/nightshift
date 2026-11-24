import type { Database } from "@nightshift/db";
import { ydoc } from "@nightshift/db/schema";
import { like } from "drizzle-orm";
import * as Y from "yjs";
import {
	createSyncedDocuments,
	deviceDocumentName,
	documentId,
	documentName,
	documentRows,
	type SyncedDocuments,
} from "../../../../documents";
import { savedSecretSchema } from "../../../../secrets";
import { profileChoice, readProfiles } from "../../../profiles";
import type { DeviceDocuments } from "../../application/ports";
import type { DeviceCopy, DeviceRecord } from "../../domain/device-copy";

/**
 * The Device documents in the `ydoc` rows of this Replica. Each copy is a
 * row named `device-copy:<id>`, apart from the `device:<id>` rows a Host
 * keeps for the Devices whose home it is. It syncs as `device:<id>`.
 */
export function yjsDeviceDocuments(deps: {
	db: Database;
	/** This Replica's synced documents. Default: its own over `db`, made at the first open. */
	documents?: SyncedDocuments;
}): DeviceDocuments<Y.Doc> {
	const { db } = deps;
	let documents = deps.documents;
	const synced = () => {
		documents ??= createSyncedDocuments({ db });
		return documents;
	};
	/** The copies opened since this adapter was made, before their first write. */
	const open = new Set<string>();

	async function fromState(
		deviceId: string,
		state: Uint8Array | null,
	): Promise<DeviceRecord | null> {
		if (!state) return null;
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, state);
			return recordOf(deviceId, doc);
		} finally {
			doc.destroy();
		}
	}

	return {
		async copyIds() {
			const rows = await db
				.select({ name: ydoc.name })
				.from(ydoc)
				.where(like(ydoc.name, `${documentName("device-copy", "")}%`));
			const ids = new Set([
				...rows.map((row) => documentId("device-copy", row.name) ?? ""),
				...open,
			]);
			return [...ids].filter((id) => id !== "");
		},
		async openCopy(deviceId) {
			open.add(deviceId);
			const { doc } = await synced().open(
				documentName("device-copy", deviceId),
			);
			return {
				record: recordOf(deviceId, doc),
				doc,
				syncName: deviceDocumentName(deviceId),
			};
		},
		async dropCopy(deviceId) {
			open.delete(deviceId);
			await synced().remove(documentName("device-copy", deviceId));
		},
		async readKept(deviceId) {
			return fromState(
				deviceId,
				await documentRows(db).fetch(deviceDocumentName(deviceId)),
			);
		},
		async readStoredCopy(deviceId) {
			return fromState(
				deviceId,
				await documentRows(db).fetch(documentName("device-copy", deviceId)),
			);
		},
	};
}

/** What a Device document says of its Device. An entry this version cannot read is left out. */
function recordOf(deviceId: string, doc: Y.Doc): DeviceRecord {
	const facts = doc.getMap("facts");
	const name = facts.get("name");
	const platform = facts.get("platform");
	const checkedAt = facts.get("checkedAt");
	const stored = facts.get("secrets");
	const secrets: DeviceCopy["secrets"] = [];
	for (const item of Array.isArray(stored) ? stored : []) {
		const parsed = savedSecretSchema.safeParse(item);
		if (parsed.success) secrets.push(parsed.data);
	}
	const profiles = [...readProfiles(doc.getMap("profiles").entries()).values()];
	return {
		copy: {
			deviceId,
			name: typeof name === "string" && name !== "" ? name : null,
			platform: typeof platform === "string" ? platform : null,
			profiles: profiles
				.map(profileChoice)
				.sort((a, b) => a.name.localeCompare(b.name)),
			secrets: secrets.sort((a, b) => a.name.localeCompare(b.name)),
			checkedAt: typeof checkedAt === "number" ? checkedAt : null,
		},
		profiles,
	};
}
