/**
 * The files of a project's knowledge on this computer: its folder, the
 * Knowledge page's listing, the read of one file, `INDEX.md` and the view
 * a step gets of some folders. `wireFiles` binds the use cases to their
 * ports.
 *
 * `fsKnowledgeFolders` and `readStart` are the disk. They are here for the
 * search (`knowledge/search.ts`) only, until lane K2 gives it ports of its
 * own.
 */

export { fsKnowledgeFolders } from "./adapters/out/fs-knowledge-folders";
export { readStart } from "./adapters/out/fs-read-start";
export type { KnowledgeView } from "./application/open-knowledge-view";
export type { KnowledgeFolders } from "./application/ports";
export { describeFile, isText } from "./domain/describe";
export {
	KNOWLEDGE_FILES_WARNING,
	type KnowledgeListing,
} from "./domain/listing";
export {
	inFolders,
	isKnowledgePath,
	isReadable,
	type KnowledgeFile,
} from "./domain/paths";
export { cutText, type KnowledgeText } from "./domain/text";
export {
	type KnowledgeFiles,
	type KnowledgeReader,
	wireFiles,
} from "./wire";
