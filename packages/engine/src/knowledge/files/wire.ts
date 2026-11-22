import { KNOWLEDGE_INDEX_INTRO } from "@nightshift/agents/knowledge";
import type { FolderSnapshot } from "../../folder-snapshot";
import { fileLoadersContentTexts } from "./adapters/out/file-loaders-content-texts";
import { fsFolderIndex } from "./adapters/out/fs-folder-index";
import { fsKnowledgeFolders } from "./adapters/out/fs-knowledge-folders";
import { fsViewCopies } from "./adapters/out/fs-view-copies";
import { timerWait } from "./adapters/out/timer-wait";
import { listDocumentFiles } from "./application/list-document-files";
import { listKnowledgeFiles } from "./application/list-knowledge-files";
import {
	type KnowledgeView,
	openKnowledgeView,
} from "./application/open-knowledge-view";
import type {
	ContentArchive,
	FolderSync,
	KnowledgeEntries,
	KnowledgeFolders,
	SpaceStatus,
	WaitingNotes,
} from "./application/ports";
import { readKnowledgeFile } from "./application/read-knowledge-file";
import { writeKnowledgeIndex } from "./application/write-knowledge-index";
import type { MarkdownRules } from "./domain/index-text";
import type { KnowledgeListing } from "./domain/listing";
import type { KnowledgeFile } from "./domain/paths";
import type { KnowledgeText, ReadFrom } from "./domain/text";

/**
 * The wiring of knowledge/files: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the knowledge gives knowledge/files: the ports another part fills, and what the real adapters stand on. */
export type FilesDeps = {
	/** Where this computer keeps its data: the folders are in its `knowledge/`. */
	dataDir: string;
	/** This Device: a file larger than 10 MB can be read only on the Device that has it. */
	deviceId: string;
	/** How long a page read waits for its reconcile. Default 2 s. */
	pageWaitMs?: number;
	/** What the Space lists: the knowledge documents of `sync`. */
	documents: KnowledgeEntries;
	/** A Project's Space and its Host (`sync`). */
	status: SpaceStatus;
	/** The content by hash: here, and at the Space's Host. */
	archive: ContentArchive;
	/** How many notes wait: the page shows the number. */
	notes: WaitingNotes;
	/** The reconcile of a folder (`sync`). */
	sync: FolderSync;
	/** Which files are markdown, and their headings (`search`): `INDEX.md` lists them. */
	markdown: MarkdownRules;
};

/** The read side of a Project's knowledge: what the document lists, and one file's text. It never changes the document or the folder. */
export type KnowledgeReader = {
	/** The files the document lists now, by path: no reconcile, no Host. */
	files(projectId: string): Promise<KnowledgeFile[]>;
	/** The Knowledge page's list, after a reconcile for a while (`listKnowledgeFiles`). */
	listing(projectId: string): Promise<KnowledgeListing>;
	/** One file of the project's knowledge (`readKnowledgeFile`). */
	read(
		projectId: string,
		path: string,
		maxBytes: number,
		from?: ReadFrom,
	): Promise<KnowledgeText | null>;
};

/** The files of the projects' knowledge on this computer, and their use cases, bound to their ports. */
export type KnowledgeFiles = {
	/** The knowledge folders on this computer. */
	folders: KnowledgeFolders;
	reader: KnowledgeReader;
	/** Writes `INDEX.md` of the snapshot's folder again when it is stale. */
	writeIndex(
		snapshot: Pick<FolderSnapshot, "dir" | "readable" | "newestReadable">,
	): Promise<void>;
	/** A view of some folders of the knowledge `source` (`openKnowledgeView`). */
	openView(
		source: string,
		files: readonly KnowledgeFile[],
		folders: readonly string[],
	): Promise<KnowledgeView>;
};

export function wireFiles(deps: FilesDeps): KnowledgeFiles {
	const folders = fsKnowledgeFolders(deps.dataDir);
	const writeIndex = writeKnowledgeIndex({
		index: fsFolderIndex(),
		markdown: deps.markdown,
		intro: KNOWLEDGE_INDEX_INTRO,
	});
	const openView = openKnowledgeView({ views: fsViewCopies(), writeIndex });
	const listing = listKnowledgeFiles({
		sync: deps.sync,
		wait: timerWait(),
		pageWaitMs: deps.pageWaitMs ?? 2_000,
		status: deps.status,
		documents: deps.documents,
		notes: deps.notes,
	});
	const files = listDocumentFiles({ documents: deps.documents });
	const read = readKnowledgeFile({
		folders,
		status: deps.status,
		documents: deps.documents,
		archive: deps.archive,
		texts: fileLoadersContentTexts(),
		deviceId: deps.deviceId,
	});
	return {
		folders,
		reader: {
			files: (projectId) => files({ projectId }),
			listing: (projectId) => listing({ projectId }),
			read: (projectId, path, maxBytes, from) =>
				read({ projectId, path, maxBytes, ...(from ? { from } : {}) }),
		},
		writeIndex: (snapshot) => writeIndex({ snapshot }),
		openView: (source, files, only) =>
			openView({ source, files, folders: only }),
	};
}
