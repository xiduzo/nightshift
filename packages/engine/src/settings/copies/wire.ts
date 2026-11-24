import type { Database } from "@nightshift/db";
import type * as Y from "yjs";
import type { SyncedDocuments } from "../../documents";
import { yjsDeviceDocuments } from "./adapters/out/yjs-device-documents";
import { keepDeviceCopies } from "./application/keep-device-copies";
import { listDeviceCopies } from "./application/list-device-copies";
import { readDeviceCopy } from "./application/read-device-copy";
import { readKeptDeviceCopy } from "./application/read-kept-device-copy";
import { readLastKnownProfiles } from "./application/read-last-known-profiles";
import type { DeviceCopy } from "./domain/device-copy";

/**
 * The copies this computer keeps of its owner's other Devices' documents.
 * Nothing on this computer writes a copy: the Host drops what a read-only
 * client sends, and only the sync changes it.
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

/** The Device documents of a Replica, as its readers use them. */
export type Copies = {
	/** The copies, as a computer with this Device id keeps them: its own document is never a copy. */
	forDevice(selfId: string): DeviceCopies;
	/** The profiles of another Device by id, as its document last said. Null when this Replica has none of its documents. */
	readLastKnownProfiles: ReturnType<typeof readLastKnownProfiles>;
	/** What the document a Host keeps for one of its Devices says. Null when it keeps none. */
	readKeptDeviceCopy: ReturnType<typeof readKeptDeviceCopy>;
};

/**
 * The Device documents over the `ydoc` rows of a Replica. The reads open
 * nothing. `forDevice` opens the copies over `documents`, made over `db`
 * at its first open when none is given.
 */
export function wireCopies(deps: {
	db: Database;
	/** This Replica's synced documents. Default: its own over `db`. */
	documents?: SyncedDocuments;
}): Copies {
	const documents = yjsDeviceDocuments(deps);
	return {
		forDevice(selfId) {
			const opened = yjsDeviceDocuments(deps);
			/** The names the Host gave, for a Device that reports none itself. */
			const named = new Map<string, string>();
			const ports = { documents: opened, selfId, named };
			const keep = keepDeviceCopies(ports);
			const list = listDeviceCopies(ports);
			const get = readDeviceCopy(ports);
			return {
				keep,
				list,
				get: (deviceId) => get({ deviceId }),
			};
		},
		readLastKnownProfiles: readLastKnownProfiles({ documents }),
		readKeptDeviceCopy: readKeptDeviceCopy({ documents }),
	};
}
