/**
 * The search over a project's knowledge folder, on this Device: by words,
 * and by meaning when this computer can. Its index is the `search-index`
 * mechanism, a rebuildable cache. `wireSearch` binds the use cases to their
 * ports. The Ollama gives the embedding model, and `measuredMeaning` adds
 * the lines Night Shift measured for it.
 */

export { setMeaning } from "./application/set-meaning";
export { DEFAULT_EMBEDDING_MODEL } from "./domain/embedding-model";
export type { KnowledgeEvaluation } from "./domain/evaluation";
export {
	type KnowledgeMeaning,
	type KnowledgeMeaningStatus,
	measuredMeaning,
} from "./domain/meaning";
export type { KnowledgeHit } from "./domain/ranking";
export { isMarkdown, markdownHeadings } from "./domain/sections";
export { type CloseNotes, type KnowledgeSearch, wireSearch } from "./wire";
