import type { Database } from "@nightshift/db";
import { clone } from "@nightshift/db/schema";
import { now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import type * as Y from "yjs";
import {
	createSyncedDocuments,
	documentName,
	type SyncedDocuments,
} from "./synced-documents";
import type { PersistedDocument } from "./ydoc";

/**
 * The Device document: one Yjs document per Device, named `device:<id>`,
 * that holds the Device's configuration (Agent Profiles, CLI Tools,
 * Connections, settings) and its facts. Its Owner is that Device: the
 * daemon holds the document, applies what its owner's UIs edit (they sync
 * through the relay), and writes it to the Replica after every change.
 * Secret values never enter it. Secret names are facts, private to the
 * owner like the rest.
 *
 * Every map holds plain JSON values. A store parses an entry when it reads
 * it, so an entry this version cannot read (a newer build's, or a bad
 * edit) is skipped and stays in the document.
 */
export type DeviceDocument = PersistedDocument & {
	/** Name → `{ description, settings, updatedAt }`. */
	readonly profiles: Y.Map<unknown>;
	/** Name → `{ description, updatedAt }`. */
	readonly cliTools: Y.Map<unknown>;
	/** Name → `{ description, server, updatedAt }`. `${NAME}` references, never values. */
	readonly connections: Y.Map<unknown>;
	/** Setting key → its saved value. A key without an entry falls back to the environment. */
	readonly settings: Y.Map<unknown>;
	/** What the Device reports about itself (`DeviceFacts`). Written by the Owner only. */
	readonly facts: Y.Map<unknown>;
	/** The profiles this Device offers into Spaces (slice 6). Empty until then. */
	readonly offers: Y.Map<unknown>;
};

/**
 * The facts a Device reports in its document. Its owner sees them; nobody
 * else does (an Offer exposes a profile's name, not these).
 */
export type DeviceFacts = {
	/** What its owner calls it: its Device name. */
	name: string;
	platform: string;
	/** Each added harness, and where its CLI is (null: not found). */
	harnesses: Record<string, string | null>;
	/** The programs it can run by name. */
	programs: string[];
	/**
	 * The secrets saved in its keychain, and when each was last set (null:
	 * not known). Never their values.
	 */
	secrets: { name: string; setAt: number | null }[];
	/**
	 * When Night Shift last read each secret to use it (epoch ms): saved
	 * ones, and ones from the daemon's environment. Not a list of the saved.
	 */
	secretsUsedAt: Record<string, number>;
	/** Its Clones: which Project, at which path. */
	clones: { projectId: string; path: string }[];
	/** When the Owner last looked (epoch ms). */
	checkedAt: number;
};

/** The name of a Device's document. */
export function deviceDocumentName(deviceId: string): string {
	return documentName("device", deviceId);
}

/**
 * Opens this computer's Device document from the Replica. A document of a
 * new install records its Device's id.
 */
export async function openDeviceDocument(options: {
	db: Database;
	deviceId: string;
	/** This Replica's synced documents. Default: its own over `db`. */
	documents?: SyncedDocuments;
}): Promise<DeviceDocument> {
	const { db, deviceId } = options;
	const documents = options.documents ?? createSyncedDocuments({ db });
	const persisted = await documents.open(deviceDocumentName(deviceId));
	const { doc } = persisted;
	const document: DeviceDocument = {
		...persisted,
		profiles: doc.getMap("profiles"),
		cliTools: doc.getMap("cliTools"),
		connections: doc.getMap("connections"),
		settings: doc.getMap("settings"),
		facts: doc.getMap("facts"),
		offers: doc.getMap("offers"),
	};

	const meta = doc.getMap("meta");
	if (meta.get("deviceId") === undefined) {
		await document.change(() => {
			meta.set("deviceId", deviceId);
		});
	}
	return document;
}

/** Sets the facts that changed. Facts are the Owner's: only it calls this. */
export function setDeviceFacts(
	document: DeviceDocument,
	facts: Partial<DeviceFacts>,
): Promise<void> {
	const changed = Object.entries(facts).filter(
		([key, value]) =>
			key !== "checkedAt" &&
			JSON.stringify(document.facts.get(key)) !== JSON.stringify(value),
	);
	if (changed.length === 0) return Promise.resolve();
	return document.change(() => {
		for (const [key, value] of changed) document.facts.set(key, value);
		document.facts.set("checkedAt", facts.checkedAt ?? now());
	});
}

/**
 * Looks at this computer again and writes the facts that changed: its
 * name, the platform, the added harnesses' CLIs, the programs, and its
 * Clones. The secret names are written by the connection store when they
 * change.
 */
export async function refreshDeviceFacts(options: {
	db: Database;
	document: DeviceDocument;
	deviceId: string;
	/** This computer's Device name. */
	name: string;
	/** Each added harness, and where its CLI is. */
	harnesses: () => Record<string, string | null>;
	programs: () => Promise<string[]>;
}): Promise<void> {
	const { db, document, deviceId } = options;
	const clones = await db
		.select({ projectId: clone.projectId, path: clone.path })
		.from(clone)
		.where(eq(clone.deviceId, deviceId))
		.orderBy(clone.path);
	await setDeviceFacts(document, {
		name: options.name,
		platform: process.platform,
		harnesses: options.harnesses(),
		programs: await options.programs(),
		clones,
		checkedAt: now(),
	});
}

/**
 * A value read from one of the document's maps, read again only after the
 * map changes. It registers nothing on the document, so a view made again
 * (a store built again on `bun --hot`) leaves nothing behind.
 */
export function mapView<T>(
	document: Pick<PersistedDocument, "revision">,
	map: Y.Map<unknown>,
	read: () => T,
): () => T {
	let cached: { revision: number; value: T } | null = null;
	return () => {
		const revision = document.revision(map);
		if (cached?.revision !== revision) cached = { revision, value: read() };
		return cached.value;
	};
}
