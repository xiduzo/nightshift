import type { FolderSnapshot } from "../../../folder-snapshot";
import type { IndexedFileWrite } from "../../../search-index";
import {
	cutText,
	describeFile,
	isText,
	type KnowledgeFolders,
} from "../../files";
import { indexedSections, type SectionPage } from "../domain/sections";
import type { VectorStates } from "../domain/vector-states";
import type { FileTexts, SearchIndex, SectionSplitter } from "./ports";

export type RefreshSearchIndexPorts = {
	folders: Pick<KnowledgeFolders, "scan">;
	texts: FileTexts;
	splitter: SectionSplitter;
	index: Pick<SearchIndex, "open" | "files" | "removeFiles" | "writeFiles">;
	/** The refresh of each project that runs now: one at a time, a second asks waits for it. */
	refreshing: Map<string, Promise<KnowledgeRefresh>>;
	states: Pick<VectorStates, "sectionsChanged">;
	/** Queues the project's vectors (`prepareVectors`). */
	prepare(request: { projectId: string }): void;
	clock: () => number;
};

/** The project to refresh. `snapshot`: the look at the folder the caller took just now. */
export type RefreshSearchIndex = {
	projectId: string;
	snapshot?: FolderSnapshot;
};

/** What a refresh did. */
export type KnowledgeRefresh = {
	/** Text files the folder has now. */
	files: number;
	/** Files read and indexed again: new or changed. */
	indexed: number;
	/** Files that went. */
	removed: number;
};

/** What the index reads of a file: past this, the end of a very large file is not found. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Files read at once while indexing. */
const BATCH = 64;

/**
 * Brings a project's index up to date with its folder, then its vectors in
 * the background, unless search by meaning is off for it.
 *
 * It has no hooks. It takes a look at the folder and reads again only the
 * files whose size or time of change differ from the index's own `files`
 * table, and drops the ones that went. A file whose content hash did not
 * change is not split again. So it stays right whoever changes the folder:
 * a sync kit, a person, or the Space's knowledge as it arrives.
 *
 * It indexes the text files (`isText`) and the text of PDF and Word files:
 * the files a person or an agent reads (`isReadable`), so not `INDEX.md`,
 * hidden files or the learnings that wait for a person. A document over
 * 10 MB is found by its path only. One refresh per project at a time: a
 * second request gets the one that runs.
 */
export const refreshSearchIndex =
	(ports: RefreshSearchIndexPorts) =>
	(request: RefreshSearchIndex): Promise<KnowledgeRefresh> => {
		const { projectId } = request;
		const running = ports.refreshing.get(projectId);
		if (running) return running;
		const next = update(ports, request)
			.then((result) => {
				ports.prepare({ projectId });
				return result;
			})
			.finally(() => ports.refreshing.delete(projectId));
		ports.refreshing.set(projectId, next);
		return next;
	};

async function update(
	ports: RefreshSearchIndexPorts,
	{ projectId, snapshot: given }: RefreshSearchIndex,
): Promise<KnowledgeRefresh> {
	const { index, texts } = ports;
	const snapshot = given ?? (await ports.folders.scan(projectId));
	const { dir } = snapshot;
	const isIndexed = (path: string) => isText(path) || texts.isDocument(path);
	const files = snapshot.readable.filter((f) => isIndexed(f.path));
	await index.open();
	const known = index.files(projectId);
	const { changed, gone } = snapshot.changedSince(known, files);
	const changes = [...changed.values()];

	let moved = false;
	if (gone.length > 0) {
		moved = true;
		index.removeFiles(gone);
	}

	for (let at = 0; at < changes.length; at += BATCH) {
		const batch = await Promise.all(
			changes
				.slice(at, at + BATCH)
				.map(async (f): Promise<IndexedFileWrite> => {
					const row = known.get(f.path);
					// A file that went since the scan is dropped by the next refresh.
					const sha256 = (await snapshot.sha256(f.path)) ?? "";
					if (row && sha256 !== "" && row.sha256 === sha256) {
						return { file: f, row, same: true };
					}
					let title: string;
					let content: string | SectionPage[];
					if (texts.isDocument(f.path)) {
						const docs = await texts.pages(dir, f.path);
						title = describeFile(f.path, { docs }).title;
						content = docs ? firstPages(docs, MAX_BODY_BYTES) : "";
					} else {
						content = (await texts.start(dir, f.path, MAX_BODY_BYTES)) ?? "";
						title = describeFile(f.path, { text: content }).title;
					}
					const split = await ports.splitter.split(f.path, content);
					const sections = indexedSections(f.path, title, split);
					return { file: f, row, same: false, sha256, title, sections };
				}),
		);
		if (index.writeFiles(projectId, batch)) moved = true;
	}
	if (moved) ports.states.sectionsChanged(projectId, ports.clock());
	return {
		files: files.length,
		indexed: changes.length,
		removed: gone.length,
	};
}

/** The pages of a document up to `bytes` of text: past that, the end is not found. */
function firstPages(
	docs: readonly SectionPage[],
	bytes: number,
): SectionPage[] {
	const out: SectionPage[] = [];
	let left = bytes;
	for (const doc of docs) {
		if (left <= 0) break;
		const cut = cutText(doc.pageContent, left);
		out.push({ pageContent: cut.text, metadata: doc.metadata });
		left -= Buffer.byteLength(cut.text);
	}
	return out;
}
