import type { Database } from "@nightshift/db";
import {
	DEFAULT_PAGE_READER,
	type PageReaderSetting,
	pageReaderSettingSchema,
} from "@nightshift/flows";
import {
	createSyncedDocuments,
	documentId,
	documentName,
	documentRows,
	type PersistedDocument,
	type SyncedDocuments,
} from "../../../../documents";
import { isKnowledgePath } from "../../../files";
import type { KnowledgeDocuments } from "../../application/ports";
import {
	entryOf,
	type KnowledgeDocument,
	type KnowledgeEntry,
} from "../../domain/entry";

/**
 * The knowledge documents over Yjs (ADR 4): one document per Project,
 * `knowledge:<projectId>`, with a map `files` (path → entry) and a map
 * `settings` (`domain/entry.ts` says what they hold). Only this file
 * knows it is Yjs.
 */

function knowledgeDocument(document: PersistedDocument): KnowledgeDocument {
	const files = document.doc.getMap<unknown>("files");
	const settings = document.doc.getMap<unknown>("settings");
	const meaningOn = () => settings.get("meaning") !== false;
	const learnsFromRunsOn = () => settings.get("learnFromRuns") !== false;
	const reader = (): PageReaderSetting => {
		const parsed = pageReaderSettingSchema.safeParse(settings.get("reader"));
		return parsed.success ? parsed.data : DEFAULT_PAGE_READER;
	};
	return {
		name: document.name,
		entries() {
			const entries = new Map<string, KnowledgeEntry>();
			for (const [path, value] of files.entries()) {
				if (!isKnowledgePath(path)) continue;
				const entry = entryOf(value);
				if (entry) entries.set(path, entry);
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
		learnsFromRunsOn,
		async setLearnsFromRuns(on) {
			if (learnsFromRunsOn() === on) return;
			await document.change(() => {
				if (on) settings.delete("learnFromRuns");
				else settings.set("learnFromRuns", false);
			});
		},
		reader,
		async setReader(setting) {
			const next = pageReaderSettingSchema.parse(setting);
			if (JSON.stringify(reader()) === JSON.stringify(next)) return;
			await document.change(() => {
				if (next.kind === "nightshift") settings.delete("reader");
				else settings.set("reader", next);
			});
		},
	};
}

/** The knowledge documents of this Replica's Projects: views of its synced documents (`documents`, default its own over `db`). */
export function yjsKnowledgeDocuments(options: {
	db: Database;
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
