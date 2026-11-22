import { KNOWLEDGE_INDEX_INTRO } from "@nightshift/agents/knowledge";
import type { FolderSnapshot } from "../../folder-snapshot";
import { isMarkdown, markdownHeadings } from "../search";
import { fsFolderIndex } from "./adapters/out/fs-folder-index";
import { fsViewCopies } from "./adapters/out/fs-view-copies";
import { openKnowledgeView } from "./application/open-knowledge-view";
import { writeKnowledgeIndex } from "./application/write-knowledge-index";
import type { KnowledgeFile } from "./domain/paths";

/** The index and the views on the disk, bound as `wireFiles` binds them: for the tests of a folder. */

const writeIndex = writeKnowledgeIndex({
	index: fsFolderIndex(),
	markdown: { isMarkdown, headings: markdownHeadings },
	intro: KNOWLEDGE_INDEX_INTRO,
});

/** Writes `INDEX.md` of the snapshot's folder again when it is stale. */
export const indexFolder = (snapshot: FolderSnapshot) =>
	writeIndex({ snapshot });

/** A view of some folders of the knowledge folder `source`. */
export const openView = (
	source: string,
	files: readonly KnowledgeFile[],
	folders: readonly string[],
) =>
	openKnowledgeView({ views: fsViewCopies(), writeIndex })({
		source,
		files,
		folders,
	});
