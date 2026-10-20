import type { Database } from "@nightshift/db";
import {
	agentProfile,
	cliTool,
	clone,
	connection,
	secret,
	setting,
} from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import type * as Y from "yjs";

import { openPersistedDocument, type PersistedDocument } from "../ydoc";

export { type DocumentRows, documentRows } from "../ydoc";

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
	platform: string;
	/** Each added harness, and where its CLI is (null: not found). */
	harnesses: Record<string, string | null>;
	/** The programs it can run by name. */
	programs: string[];
	/** The names of the secrets saved in its keychain. Never their values. */
	secrets: string[];
	/** Its Clones: which Project, at which path. */
	clones: { projectId: string; path: string }[];
	/** When the Owner last looked (epoch ms). */
	checkedAt: number;
};

/** The name of a Device's document. */
export function deviceDocumentName(deviceId: string): string {
	return `device:${deviceId}`;
}

/** The transaction origin of the Owner's own changes. */
export const OWNER_ORIGIN = Symbol("device-document-owner");

/**
 * Opens this computer's Device document from the Replica. On the first
 * start of a Replica without one, the rows of the tables it replaces
 * (`agent_profile`, `cli_tool`, `connection`, `setting`, `secret`) are
 * imported into it, once: the document records that it did.
 */
export async function openDeviceDocument(options: {
	db: Database;
	deviceId: string;
}): Promise<DeviceDocument> {
	const { db, deviceId } = options;
	const persisted = await openPersistedDocument({
		db,
		name: deviceDocumentName(deviceId),
		origin: OWNER_ORIGIN,
		label: "The Device document",
	});
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
	if (meta.get("importedAt") === undefined) {
		const legacy = await readLegacyRows(db);
		await document.change(() => {
			meta.set("deviceId", deviceId);
			meta.set("importedAt", Date.now());
			for (const [key, value] of legacy.settings)
				document.settings.set(key, value);
			for (const [key, value] of legacy.connections)
				document.connections.set(key, value);
			for (const [key, value] of legacy.cliTools)
				document.cliTools.set(key, value);
			for (const [key, value] of legacy.profiles)
				document.profiles.set(key, value);
			if (legacy.secrets.length > 0)
				document.facts.set("secrets", legacy.secrets);
		});
	}
	return document;
}

/**
 * The rows of the tables the document replaced, as document entries.
 * JSON that does not parse is left out; JSON that parses is copied as is,
 * and the stores check it when they read it.
 */
async function readLegacyRows(db: Database) {
	const settings: [string, unknown][] = [];
	for (const row of await db.select().from(setting)) {
		const value = safeJson(row.value);
		if (value !== undefined) settings.push([row.key, value]);
	}
	const connections: [string, unknown][] = [];
	for (const row of await db.select().from(connection)) {
		const server = safeJson(row.server);
		if (server === undefined) continue;
		connections.push([
			row.name,
			{
				description: row.description,
				server,
				updatedAt: row.updatedAt.getTime(),
			},
		]);
	}
	const cliTools: [string, unknown][] = (await db.select().from(cliTool)).map(
		(row) => [
			row.name,
			{ description: row.description, updatedAt: row.updatedAt.getTime() },
		],
	);
	const profiles: [string, unknown][] = [];
	for (const row of await db.select().from(agentProfile)) {
		const parsed = safeJson(row.settings);
		if (parsed === undefined) continue;
		profiles.push([
			row.name,
			{
				description: row.description,
				settings: parsed,
				updatedAt: row.updatedAt.getTime(),
			},
		]);
	}
	const secrets = (await db.select({ name: secret.name }).from(secret))
		.map((row) => row.name)
		.sort();
	return { settings, connections, cliTools, profiles, secrets };
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
		document.facts.set("checkedAt", facts.checkedAt ?? Date.now());
	});
}

/**
 * Looks at this computer again and writes the facts that changed: the
 * platform, the added harnesses' CLIs, the programs, and its Clones. The
 * secret names are written by the connection store when they change.
 */
export async function refreshDeviceFacts(options: {
	db: Database;
	document: DeviceDocument;
	deviceId: string;
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
		platform: process.platform,
		harnesses: options.harnesses(),
		programs: await options.programs(),
		clones,
		checkedAt: Date.now(),
	});
}

/** The facts as the Owner last wrote them. A fact not written yet is missing. */
export function deviceFacts(document: DeviceDocument): Partial<DeviceFacts> {
	return document.facts.toJSON() as Partial<DeviceFacts>;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
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
