/**
 * The files of a project's knowledge on this computer: its folder, the
 * Knowledge page's listing, the read of one file, `INDEX.md` and the view
 * a step gets of some folders. `wireFiles` binds the use cases to their
 * ports.
 */

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
