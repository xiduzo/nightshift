import type { PageReaderSetting } from "@nightshift/flows";
import type {
	ContentArchive,
	FolderSync,
	KnowledgeEntries,
	SpaceStatus,
	WaitingNotes,
} from "../../application/ports";
import type { ListedEntry } from "../../domain/listing";
import { inMemoryContentTexts } from "./in-memory-content-texts";
import { inMemoryFolderIndex } from "./in-memory-folder-index";
import { inMemoryKnowledgeFolders } from "./in-memory-knowledge-folders";
import { inMemoryViewCopies } from "./in-memory-view-copies";
import { inMemoryWait } from "./in-memory-wait";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryFilesPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** The knowledge documents in memory: a test lists an entry (`list`) as the Space would. */
export function inMemoryKnowledgeEntries() {
	const documents = new Map<string, Map<string, ListedEntry>>();
	const twin = {
		/** How many times a document was opened. */
		opened: 0,
		learnsFromRuns: true,
		reader: { kind: "nightshift" } as PageReaderSetting,
		/** Lists an entry in the project's document. */
		list(projectId: string, path: string, entry: ListedEntry) {
			const entries = documents.get(projectId) ?? new Map();
			entries.set(path, entry);
			documents.set(projectId, entries);
		},
		async open(projectId: string) {
			twin.opened++;
			return {
				entries: () => new Map(documents.get(projectId) ?? []),
				learnsFromRunsOn: () => twin.learnsFromRuns,
				reader: () => twin.reader,
			};
		},
	};
	return twin satisfies KnowledgeEntries;
}

/** The Spaces of the projects in memory: `p1` is in the shared Space `s1`, unless a test says otherwise. */
export function inMemorySpaceStatus() {
	const spaces = new Map<string, string>([["p1", "s1"]]);
	const twin = {
		shared: true,
		setSpace(projectId: string, spaceId: string | null) {
			if (spaceId === null) spaces.delete(projectId);
			else spaces.set(projectId, spaceId);
		},
		async spaceOf(projectId: string) {
			return spaces.get(projectId) ?? null;
		},
		async isShared() {
			return twin.shared;
		},
	};
	return twin satisfies SpaceStatus;
}

/** The content by hash in memory. `fail` makes each read throw, as a Host that is down. */
export function inMemoryContentArchive() {
	const contents = new Map<string, Uint8Array>();
	const twin = {
		failWith: null as unknown,
		keep(sha256: string, text: string) {
			contents.set(sha256, new TextEncoder().encode(text));
		},
		async read(ref: { kind: "content"; spaceId: string; sha256: string }) {
			if (twin.failWith !== null) throw twin.failWith;
			return contents.get(ref.sha256) ?? null;
		},
	};
	return twin satisfies ContentArchive;
}

/** How many notes wait, in memory. */
export function inMemoryWaitingNotes() {
	const twin = {
		count: async () => twin.notes,
		notes: 0,
	};
	return twin satisfies WaitingNotes;
}

/** The reconcile in memory: it ends at once, or never after `hang`. It keeps each project it is asked for. */
export function inMemoryFolderSync() {
	let hangs = false;
	const twin = {
		asked: [] as string[],
		hang() {
			hangs = true;
		},
		reconcileUnlessHeld(projectId: string): Promise<unknown> {
			twin.asked.push(projectId);
			return hangs ? new Promise(() => {}) : Promise.resolve();
		},
	};
	return twin satisfies FolderSync;
}

/** Every port of knowledge/files in memory at once: where each use-case test starts. */
export function inMemoryFilesPorts() {
	const views = inMemoryViewCopies();
	const index = inMemoryFolderIndex();
	return {
		folders: inMemoryKnowledgeFolders(),
		index,
		views,
		texts: inMemoryContentTexts(),
		wait: inMemoryWait(),
		pageWaitMs: 2_000,
		documents: inMemoryKnowledgeEntries(),
		status: inMemorySpaceStatus(),
		archive: inMemoryContentArchive(),
		notes: inMemoryWaitingNotes(),
		sync: inMemoryFolderSync(),
		deviceId: "laptop",
		markdown: {
			isMarkdown: (path: string) => path.endsWith(".md"),
			headings: (text: string) =>
				text.split("\n").flatMap((line) => {
					const match = /^(#{1,6})\s+(.+)$/.exec(line);
					return match?.[1] && match[2]
						? [{ level: match[1].length, text: match[2] }]
						: [];
				}),
		},
		intro: "Read this index first.",
	};
}
