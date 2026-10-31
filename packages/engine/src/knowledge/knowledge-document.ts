import type { Database } from "@nightshift/db";
import { z } from "zod";
import {
	createSyncedDocuments,
	documentName,
	type PersistedDocument,
	type SyncedDocuments,
} from "../documents";
import { isKnowledgePath } from "./folder";

/**
 * The knowledge document (ADR 4): the files of a Project's knowledge, in
 * one Yjs document per Project, `knowledge:<projectId>`. Every Device of
 * the Project's Space keeps a copy in its Replica, and the relay serves
 * it beside the flow documents. The content is not in it: a Device keeps
 * each file's content by its hash (the Space archive) and copies it to the
 * Space's Host.
 *
 * `files`: path → `{ sha256, size, changedAt, deviceId, local? }`, one
 * plain value per path. Entries merge per path: when two Devices change
 * one path, Yjs keeps one of them, and the next reconcile makes the later
 * change win (`createKnowledgeSync`). `local`: the file is larger than
 * 10 MB and stays on the Device that has it.
 *
 * `settings`: the project's knowledge settings, one plain value per name,
 * so every Device of the Space searches the same way. `meaning: false`:
 * search finds by words only for this project, though Ollama is there.
 */

/** One file of the knowledge, as the document lists it. */
export type KnowledgeEntry = {
	/** The hash of its content: where the content is kept. */
	sha256: string;
	/** Bytes. */
	size: number;
	/** Epoch ms: when the Device that changed it last changed it. */
	changedAt: number;
	/** The Device that changed it last. */
	deviceId: string;
	/** Larger than 10 MB: it stays on `deviceId`, and other Devices do not fetch it. */
	local?: true;
};

const entrySchema = z.object({
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	size: z.number().int().min(0),
	changedAt: z.number().finite(),
	deviceId: z.string().min(1),
	local: z.literal(true).optional(),
});

/** The document's `files`: path → entry. */
export function knowledgeFiles(document: PersistedDocument) {
	return document.doc.getMap<unknown>("files");
}

/** Every valid entry of the document, by path. */
export function knowledgeEntries(
	document: PersistedDocument,
): Map<string, KnowledgeEntry> {
	const entries = new Map<string, KnowledgeEntry>();
	for (const [path, value] of knowledgeFiles(document).entries()) {
		if (!isKnowledgePath(path)) continue;
		const parsed = entrySchema.safeParse(value);
		if (!parsed.success) continue;
		const { local, ...entry } = parsed.data;
		entries.set(path, local ? { ...entry, local } : entry);
	}
	return entries;
}

/** The document's `settings`: name → value. */
function knowledgeSettings(document: PersistedDocument) {
	return document.doc.getMap<unknown>("settings");
}

/** Whether search by meaning is on for the project: on unless a person turned it off. */
export function meaningIsOn(document: PersistedDocument): boolean {
	return knowledgeSettings(document).get("meaning") !== false;
}

/** Turns search by meaning on or off for the project, for every Device of its Space. */
export async function setMeaning(
	document: PersistedDocument,
	on: boolean,
): Promise<void> {
	if (meaningIsOn(document) === on) return;
	const settings = knowledgeSettings(document);
	await document.change(() => {
		if (on) settings.delete("meaning");
		else settings.set("meaning", false);
	});
}

/** The knowledge documents of this Replica's Projects: views of its synced documents. */
export type KnowledgeDocuments = {
	/** The Project's knowledge document. */
	open(projectId: string): Promise<PersistedDocument>;
	/** Closes the Project's knowledge document and deletes it from this Replica: its Project moved to another id. */
	remove(projectId: string): Promise<void>;
};

export function createKnowledgeDocuments(options: {
	db: Database;
	/** This Replica's synced documents. Default: its own over `db`. */
	documents?: SyncedDocuments;
}): KnowledgeDocuments {
	const documents =
		options.documents ?? createSyncedDocuments({ db: options.db });
	return {
		open: (projectId) => documents.open(documentName("knowledge", projectId)),
		remove: (projectId) =>
			documents.remove(documentName("knowledge", projectId)),
	};
}
