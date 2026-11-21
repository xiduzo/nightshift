import {
	isProposedLearning,
	isQuestionSetPath,
	type PageReaderSetting,
} from "@nightshift/flows";
import type { KnowledgeFile } from "./paths";

/** What the Knowledge page lists, and what a read of one file says when it cannot give it. */

/**
 * Past this many files, the folder is too large to read well: the
 * Knowledge page warns: agents find more with `search_knowledge` than by a grep.
 */
export const KNOWLEDGE_FILES_WARNING = 2000;

/** What the Knowledge page lists: the document's files, and the learnings that wait. */
export type KnowledgeListing = {
	/** The files, the proposed learnings left out, by path. */
	files: KnowledgeFile[];
	/** How many notes the proposed learnings hold. */
	proposed: number;
	/** The Project's Space is not a personal one: each of its Members reads the knowledge. */
	shared: boolean;
	/**
	 * The Host that keeps the Space runs an older version of Night Shift:
	 * it cannot take this knowledge yet. This Device works on its own copy.
	 */
	olderHost: boolean;
	/** Night Shift proposes learnings from the runs of the project that ended (ADR 37). */
	learnsFromRuns: boolean;
	/** The page reader of the project (ADR 39). */
	reader: PageReaderSetting;
};

/** One file as the Space's document lists it (`KnowledgeEntry` of `sync`). */
export type ListedEntry = {
	sha256: string;
	size: number;
	changedAt: number;
	deviceId: string;
	local?: true;
};

/**
 * The files the document lists, by path. The question set is Night
 * Shift's own: the page shows it elsewhere. The proposed learnings wait:
 * the page counts them.
 */
export function listedFiles(
	entries: ReadonlyMap<string, ListedEntry>,
): KnowledgeFile[] {
	const listed: KnowledgeFile[] = [];
	for (const [path, entry] of [...entries].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (isQuestionSetPath(path) || isProposedLearning(path)) continue;
		listed.push({
			path,
			size: entry.size,
			changedAt: entry.changedAt,
			...(entry.local ? { local: true as const } : {}),
		});
	}
	return listed;
}

/** One Project's knowledge document, as a read of the files sees it. */
export type ListedDocument = {
	/** Every valid entry, by path. */
	entries(): Map<string, ListedEntry>;
	/** Whether Night Shift proposes learnings from the runs of the Project that ended (ADR 37). */
	learnsFromRunsOn(): boolean;
	/** The page reader of the Project (ADR 39). */
	reader(): PageReaderSetting;
};

/** A file larger than 10 MB that another Device synced: only that Device reads it. */
export const ON_ANOTHER_DEVICE =
	"This file is larger than 10 MB. It stays on the computer that synced it.";

/** The content of a file is neither here nor at the Host now. */
export const NOT_FETCHED =
	"Night Shift cannot get this file now. Try again when the computer that keeps this Space is online.";
