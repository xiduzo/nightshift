import type { Database } from "@nightshift/db";
import { ydoc } from "@nightshift/db/schema";
import type { ProfileSettings } from "@nightshift/flows";
import { like, or } from "drizzle-orm";
import * as Y from "yjs";
import type { DeviceProfile } from "../contract";
import {
	createSyncedDocuments,
	documentId,
	documentKind,
	documentName,
	documentRows,
	type PersistedDocument,
	type SyncedDocuments,
} from "../documents";
import { savedSecretSchema } from "./connections";
import { deviceDocumentName } from "./device-document";
import { profileChoice, readProfiles } from "./profiles";

/**
 * Copies of the Device documents of this computer's owner's other
 * Devices: the home Host syncs them here, read-only (ADR 1, decisions 2
 * and 3). They tell this computer the name, the profiles and the secret
 * names of each of those Devices, also while that Device or the Host is
 * offline. Secret values never enter a Device document, so none is here.
 *
 * Each copy is a row of `ydoc` named `device-copy:<id>`, apart from the
 * `device:<id>` rows a Host keeps for the Devices whose home it is. It
 * syncs as `device:<id>`. Nothing on this computer writes a copy: the
 * Host drops what a read-only client sends, and only the sync changes it.
 */
export type DeviceCopies = {
	/**
	 * Keeps a copy of each of these Devices' documents, and drops the
	 * copies of every other Device: what the home Host lists, with the name
	 * it knows each by. Returns the documents to sync, under their Device
	 * document names.
	 */
	keep(
		devices: readonly { id: string; name: string }[],
	): Promise<{ name: string; doc: Y.Doc }[]>;
	/** Every copy this computer keeps, by Device name. */
	list(): Promise<DeviceCopy[]>;
	/** The copy of one Device's document, or null when this computer has none. */
	get(deviceId: string): Promise<DeviceCopy | null>;
};

/** One Device of the owner, as its last synced document says. */
export type DeviceCopy = {
	deviceId: string;
	/**
	 * The name it reports, else the name the Host last gave it. Null: neither
	 * is known (a Device of an older version, and no answer of the Host since
	 * this computer started).
	 */
	name: string | null;
	/** `process.platform`. Null: not reported yet. */
	platform: string | null;
	/** Its profiles, by name. */
	profiles: DeviceProfile[];
	/** The names of the secrets saved on it, by name. Never their values. */
	secrets: { name: string; setAt: number | null }[];
	/** When the Device last looked at itself (epoch ms). Null: not reported yet. */
	checkedAt: number | null;
};

export function createDeviceCopies(deps: {
	db: Database;
	/** This computer's Device id: its own document is never a copy. */
	selfId: string;
	/** This Replica's synced documents. Default: its own over `db`. */
	documents?: SyncedDocuments;
}): DeviceCopies {
	const { db, selfId } = deps;
	const documents = deps.documents ?? createSyncedDocuments({ db });
	/** The names the Host gave, for a Device that reports none itself. */
	const named = new Map<string, string>();
	/** The copies opened since this view was made, before their first write. */
	const open = new Set<string>();

	function opened(deviceId: string): Promise<PersistedDocument> {
		open.add(deviceId);
		return documents.open(documentName("device-copy", deviceId));
	}

	/** The Device ids of the copies: in the Replica, and open before their first write. */
	async function stored(): Promise<string[]> {
		const rows = await db
			.select({ name: ydoc.name })
			.from(ydoc)
			.where(like(ydoc.name, `${documentName("device-copy", "")}%`));
		const ids = new Set([
			...rows.map((row) => documentId("device-copy", row.name) ?? ""),
			...open,
		]);
		return [...ids].filter((id) => id !== "" && id !== selfId);
	}

	async function drop(deviceId: string) {
		open.delete(deviceId);
		named.delete(deviceId);
		await documents.remove(documentName("device-copy", deviceId));
	}

	async function copyOf(deviceId: string): Promise<DeviceCopy> {
		const copy = readCopy(deviceId, (await opened(deviceId)).doc);
		return { ...copy, name: copy.name ?? named.get(deviceId) ?? null };
	}

	return {
		async keep(devices) {
			const listed = devices.filter((d) => d.id !== selfId);
			for (const d of listed) named.set(d.id, d.name);
			const wanted = new Set(listed.map((d) => d.id));
			for (const id of await stored()) {
				if (!wanted.has(id)) await drop(id);
			}
			const synced: { name: string; doc: Y.Doc }[] = [];
			for (const id of [...wanted].sort()) {
				synced.push({
					name: deviceDocumentName(id),
					doc: (await opened(id)).doc,
				});
			}
			return synced;
		},
		async list() {
			const copies = await Promise.all((await stored()).map(copyOf));
			return copies.sort(
				(a, b) =>
					(a.name ?? "").localeCompare(b.name ?? "") ||
					a.deviceId.localeCompare(b.deviceId),
			);
		},
		async get(deviceId) {
			if (deviceId === selfId) return null;
			if (!(await stored()).includes(deviceId)) return null;
			return copyOf(deviceId);
		},
	};
}

/** What a copy says of its Device. An entry this version cannot read is left out. */
function readCopy(deviceId: string, doc: Y.Doc): DeviceCopy {
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
	return {
		deviceId,
		name: typeof name === "string" && name !== "" ? name : null,
		platform: typeof platform === "string" ? platform : null,
		profiles: [...readProfiles(doc.getMap("profiles")).values()]
			.map(profileChoice)
			.sort((a, b) => a.name.localeCompare(b.name)),
		secrets: secrets.sort((a, b) => a.name.localeCompare(b.name)),
		checkedAt: typeof checkedAt === "number" ? checkedAt : null,
	};
}

/**
 * Every Device whose document this Replica keeps, as that document says:
 * its own (`device:<id>`), those a Host keeps for the Devices whose home
 * it is, and the copies of its owner's other Devices (`device-copy:<id>`).
 * One entry per Device: a kept document wins over a copy.
 */
export async function storedDevices(db: Database): Promise<DeviceCopy[]> {
	const rows = await db
		.select({ name: ydoc.name, state: ydoc.state })
		.from(ydoc)
		.where(
			or(
				like(ydoc.name, `${documentName("device", "")}%`),
				like(ydoc.name, `${documentName("device-copy", "")}%`),
			),
		);
	const found = new Map<string, DeviceCopy>();
	for (const row of rows.sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const named = documentKind(row.name);
		if (!named) continue;
		const { kind, id: deviceId } = named;
		if (kind === "device-copy" && found.has(deviceId)) continue;
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, new Uint8Array(row.state));
			found.set(deviceId, readCopy(deviceId, doc));
		} catch {
			// A document this version cannot read names no Device.
		} finally {
			doc.destroy();
		}
	}
	return [...found.values()];
}

/**
 * The profiles of another Device as its document last said, by id, with
 * their names: from the document a Host keeps for it, else this Replica's
 * copy. What a run starts from while that Device is offline (ADR 1,
 * decision 11). Null when this Replica has neither.
 */
export async function lastKnownProfiles(
	db: Database,
	deviceId: string,
): Promise<Map<string, { name: string; settings: ProfileSettings }> | null> {
	const rows = documentRows(db);
	const state =
		(await rows.fetch(deviceDocumentName(deviceId))) ??
		(await rows.fetch(documentName("device-copy", deviceId)));
	if (!state) return null;
	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, state);
		const known = new Map<
			string,
			{ name: string; settings: ProfileSettings }
		>();
		for (const profile of readProfiles(doc.getMap("profiles")).values()) {
			const {
				id,
				name,
				description: _description,
				updatedAt: _at,
				...settings
			} = profile;
			known.set(id, { name, settings });
		}
		return known;
	} finally {
		doc.destroy();
	}
}

/**
 * What a Host's Device document of a Device whose home Host it is says of
 * that Device (the document it keeps, `device:<id>`). Null when it keeps
 * none.
 */
export async function storedDeviceCopy(
	db: Database,
	deviceId: string,
): Promise<DeviceCopy | null> {
	const state = await documentRows(db).fetch(deviceDocumentName(deviceId));
	if (!state) return null;
	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, state);
		return readCopy(deviceId, doc);
	} finally {
		doc.destroy();
	}
}
