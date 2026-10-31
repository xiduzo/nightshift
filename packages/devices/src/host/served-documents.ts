import { documentAccess, type SyncAuthorize } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { documentRows, type SyncedDocuments } from "@nightshift/engine";
import type * as Y from "yjs";
import type { DeviceRegistry } from "../registry";

/**
 * Documents a Host keeps for others: the Device documents of the Devices
 * whose home Host it is. The relay loads them from the Replica's `ydoc`
 * rows and stores them back after changes. The engine never opens them.
 */
export type KeptDocuments = {
	/** Whether this Host keeps a document of that name. */
	has(name: string): boolean | Promise<boolean>;
	fetch(name: string): Promise<Uint8Array | null>;
	store(name: string, state: Uint8Array): Promise<void>;
};

/**
 * What a Replica serves over the document channel, by name: the documents
 * it owns, the documents it keeps for others, and who may open which.
 * Each adapter of the channel serves exactly this: the daemon's relay
 * (Hocuspocus over a socket) and the Host in memory of the tests.
 */
export type ServedDocuments = {
	/** The live document this Replica owns under that name, or null. */
	document(name: string): Y.Doc | null | Promise<Y.Doc | null>;
	/** The documents it keeps for others. None by default. */
	kept?: KeptDocuments;
	authorize: SyncAuthorize;
};

/** The options of `documentAccess` that sessions need: the daemon's, or none in memory. */
type SessionAccess = Pick<
	Parameters<typeof documentAccess>[0],
	"auth" | "localSession" | "ownerId" | "isThisComputer" | "policy"
>;

/**
 * The documents this Replica serves: every document it syncs
 * (`SyncedDocuments`), and on a Host the Device documents it keeps for
 * the Devices whose home it is, from its rows. Who may open which is
 * `documentAccess`: `sessions` decides for a browser, and a Device key
 * (`deviceKey`) for a Device.
 */
export function servedDocuments(deps: {
	db: Database;
	documents: Pick<SyncedDocuments, "find" | "documentOf">;
	registry: Pick<DeviceRegistry, "keptDocumentOwner">;
	/** A Device key as the relay checks it (`Host.syncKey`). */
	deviceKey: NonNullable<Parameters<typeof documentAccess>[0]["deviceKey"]>;
	sessions: SessionAccess;
}): ServedDocuments {
	const keptOwner = (name: string) => deps.registry.keptDocumentOwner(name);
	return {
		document: async (name) => (await deps.documents.find(name))?.doc ?? null,
		kept: {
			has: async (name) => (await keptOwner(name)) !== null,
			...documentRows(deps.db),
		},
		authorize: documentAccess({
			...deps.sessions,
			db: deps.db,
			documentOf: (name) => deps.documents.documentOf(name),
			keptOwner,
			deviceKey: deps.deviceKey,
		}),
	};
}
