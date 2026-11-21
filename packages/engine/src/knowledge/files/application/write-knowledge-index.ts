import type { FolderSnapshot } from "../../../folder-snapshot";
import { describeFile } from "../domain/describe";
import {
	indexIsStale,
	indexLine,
	indexText,
	type MarkdownRules,
	OUTLINE_BYTES,
	outlinedPaths,
	outlineOf,
	outlineSource,
} from "../domain/index-text";
import type { FolderIndex } from "./ports";

export type WriteKnowledgeIndexPorts = {
	index: FolderIndex;
	markdown: MarkdownRules;
	/** The first line under the title (`KNOWLEDGE_INDEX_INTRO` of `agents`): an index without it is of another version. */
	intro: string;
};

/** The folder whose index to write, as a look at it found it. */
export type WriteKnowledgeIndex = {
	snapshot: Pick<FolderSnapshot, "dir" | "readable" | "newestReadable">;
};

/**
 * Writes `INDEX.md` at the top of the snapshot's folder again when it is
 * stale, over the files a person or an agent reads there. A folder that is
 * not there is made. Night Shift asks it: when an agent gets the folder,
 * and for a view.
 */
export const writeKnowledgeIndex =
	(ports: WriteKnowledgeIndexPorts) =>
	async ({ snapshot }: WriteKnowledgeIndex): Promise<void> => {
		const { dir, readable: files, newestReadable: newest } = snapshot;
		const written = await ports.index.written(dir);
		if (!indexIsStale(written, files, newest, ports.intro)) return;
		const outlined = outlinedPaths(files, ports.markdown.isMarkdown);
		const lines = await Promise.all(
			files.map(async (file) => {
				const description = describeFile(
					file.path,
					await ports.index.source(dir, file.path),
				);
				const outline = outlined.has(file.path)
					? await readOutline(dir, file.path, description.title)
					: "";
				return indexLine(file, description, outline);
			}),
		);
		await ports.index.write(dir, indexText(lines, ports.intro));

		/** The headings of a markdown file on one line. Empty: it has none, or it went. */
		async function readOutline(
			dir: string,
			path: string,
			title: string,
		): Promise<string> {
			const head = await ports.index.head(dir, path, OUTLINE_BYTES);
			if (!head) return "";
			const source = outlineSource(head);
			return outlineOf(
				ports.markdown.headings(source.text),
				title,
				source.whole,
			);
		}
	};
