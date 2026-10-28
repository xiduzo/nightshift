import type { Database } from "@nightshift/db";
import { ydoc } from "@nightshift/db/schema";
import { eq, like, or } from "drizzle-orm";
import * as Y from "yjs";
import type { DeviceProfile } from "../contract";
import { savedSecretSchema } from "./connections";
import { deviceDocumentName } from "./device-document";
import { profileChoice, readProfiles } from "./profiles";
import {
	documentRows,
	openPersistedDocument,
	type PersistedDocument,
} from "./ydoc";

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
	/** Writes what synced, then stops keeping the copies. */
	close(): Promise<void>;
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

const PREFIX = "device-copy:";

/** The transaction origin of the sync: the only writer of a copy. */
const COPY_ORIGIN = Symbol("device-copy");

export function createDeviceCopies(deps: {
	db: Database;
	/** This computer's Device id: its own document is never a copy. */
	selfId: string;
}): DeviceCopies {
	const { db, selfId } = deps;
	const open = new Map<string, Promise<PersistedDocument>>();
	/** The names the Host gave, for a Device that reports none itself. */
	const named = new Map<string, string>();

	function opened(deviceId: string): Promise<PersistedDocument> {
		let document = open.get(deviceId);
		if (!document) {
			document = openPersistedDocument({
				db,
				name: `${PREFIX}${deviceId}`,
				origin: COPY_ORIGIN,
				label: "The copy of the Device document",
			});
			open.set(deviceId, document);
		}
		return document;
	}

	/** The Device ids of the copies: in the Replica, and open before their first write. */
	async function stored(): Promise<string[]> {
		const rows = await db
			.select({ name: ydoc.name })
			.from(ydoc)
			.where(like(ydoc.name, `${PREFIX}%`));
		const ids = new Set([
			...rows.map((row) => row.name.slice(PREFIX.length)),
			...open.keys(),
		]);
		return [...ids].filter((id) => id !== "" && id !== selfId);
	}

	async function drop(deviceId: string) {
		const document = open.get(deviceId);
		open.delete(deviceId);
		named.delete(deviceId);
		if (document) await (await document).close();
		await db.delete(ydoc).where(eq(ydoc.name, `${PREFIX}${deviceId}`));
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
		async close() {
			const documents = [...open.values()];
			open.clear();
			for (const document of documents) await (await document).close();
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
		.where(or(like(ydoc.name, "device:%"), like(ydoc.name, `${PREFIX}%`)));
	const found = new Map<string, DeviceCopy>();
	for (const row of rows.sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const copy = row.name.startsWith(PREFIX);
		const deviceId = row.name.slice(copy ? PREFIX.length : "device:".length);
		if (deviceId === "" || (copy && found.has(deviceId))) continue;
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
