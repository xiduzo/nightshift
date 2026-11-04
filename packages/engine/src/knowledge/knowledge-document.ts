import type { Database } from "@nightshift/db";
import { z } from "zod";
import {
	createSyncedDocuments,
	documentId,
	documentName,
	documentRows,
	type PersistedDocument,
	type SyncedDocuments,
} from "../documents";
import { isKnowledgePath } from "./folder-snapshot";

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

/**
 * One Project's knowledge document, as the knowledge reads and writes it.
 * Only this module knows it is Yjs.
 */
export type KnowledgeDocument = {
	/** The document's name in the Space: what a Replica keeps in step with its Host. */
	readonly name: string;
	/** Every valid entry, by path. */
	entries(): Map<string, KnowledgeEntry>;
	/**
	 * Whether the document never had an update: a new Replica's copy. Its
	 * files were not removed, it only does not list them yet.
	 */
	isNew(): boolean;
	/**
	 * Changes entries in one change, removals first. Resolves when this
	 * Replica has it. Nothing to change writes nothing.
	 */
	apply(change: {
		set?: readonly (readonly [string, KnowledgeEntry])[];
		delete?: readonly string[];
	}): Promise<void>;
	/**
	 * Every hash the document names, with an entry `entries` leaves out (a
	 * path that is no knowledge, a value of another version): what any
	 * Replica may still fetch.
	 */
	allHashes(): Set<string>;
	/** Whether search by meaning is on for the Project: on unless a person turned it off. */
	meaningOn(): boolean;
	/** Turns search by meaning on or off for the Project, for every Device of its Space. */
	setMeaning(on: boolean): Promise<void>;
};

function knowledgeDocument(document: PersistedDocument): KnowledgeDocument {
	const files = document.doc.getMap<unknown>("files");
	const settings = document.doc.getMap<unknown>("settings");
	const meaningOn = () => settings.get("meaning") !== false;
	return {
		name: document.name,
		entries() {
			const entries = new Map<string, KnowledgeEntry>();
			for (const [path, value] of files.entries()) {
				if (!isKnowledgePath(path)) continue;
				const parsed = entrySchema.safeParse(value);
				if (!parsed.success) continue;
				const { local, ...entry } = parsed.data;
				entries.set(path, local ? { ...entry, local } : entry);
			}
			return entries;
		},
		isNew: () => document.doc.store.clients.size === 0,
		async apply(change) {
			const removed = change.delete ?? [];
			const set = change.set ?? [];
			if (removed.length === 0 && set.length === 0) return;
			await document.change(() => {
				for (const path of removed) files.delete(path);
				for (const [path, entry] of set) files.set(path, entry);
			});
		},
		allHashes() {
			const hashes = new Set<string>();
			for (const value of files.values()) {
				const sha256 = (value as { sha256?: unknown } | null)?.sha256;
				if (typeof sha256 === "string") hashes.add(sha256);
			}
			return hashes;
		},
		meaningOn,
		async setMeaning(on) {
			if (meaningOn() === on) return;
			await document.change(() => {
				if (on) settings.delete("meaning");
				else settings.set("meaning", false);
			});
		},
	};
}

/** The knowledge documents of this Replica's Projects: views of its synced documents. */
export type KnowledgeDocuments = {
	/** The Project's knowledge document. */
	open(projectId: string): Promise<KnowledgeDocument>;
	/** Closes the Project's knowledge document and deletes it from this Replica: its Project moved to another id. */
	remove(projectId: string): Promise<void>;
	/**
	 * The size of each knowledge document this Replica keeps, in bytes. Yjs
	 * keeps a deleted entry for ever (`docs/knowledge.md`, "How the knowledge
	 * document grows"), so this is its growth. It loads no document.
	 */
	sizes(): Promise<{ projectId: string; bytes: number }[]>;
};

export function createKnowledgeDocuments(options: {
	db: Database;
	/** This Replica's synced documents. Default: its own over `db`. */
	documents?: SyncedDocuments;
}): KnowledgeDocuments {
	const documents =
		options.documents ?? createSyncedDocuments({ db: options.db });
	return {
		open: async (projectId) =>
			knowledgeDocument(
				await documents.open(documentName("knowledge", projectId)),
			),
		remove: (projectId) =>
			documents.remove(documentName("knowledge", projectId)),
		async sizes() {
			const rows = await documentRows(options.db).sizes(
				documentName("knowledge", ""),
			);
			return rows.flatMap(({ name, bytes }) => {
				const projectId = documentId("knowledge", name);
				return projectId === null ? [] : [{ projectId, bytes }];
			});
		},
	};
}
