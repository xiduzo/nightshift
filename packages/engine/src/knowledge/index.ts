/**
 * Knowledge: a project's files an agent may read, outside the repository.
 * The Space has them (ADR 4): a document lists them by hash, the content
 * travels by hash through the Space's Host, and each Device's folder is a
 * working copy that a reconcile keeps in step before and after each step.
 */

export {
	KNOWLEDGE_FILES_WARNING,
	type KnowledgeFile,
	type KnowledgeText,
} from "./folder";
export {
	createKnowledgeDocuments,
	type KnowledgeDocuments,
	knowledgeDocumentProject,
} from "./knowledge-document";
export { isLearningsFolder } from "./learnings";
export {
	createProjectKnowledge,
	type KnowledgeRequest,
	type ProjectKnowledge,
} from "./project-knowledge";
export type { KnowledgeHost } from "./reconcile";
export {
	createKnowledgeSearch,
	type KnowledgeHit,
	type KnowledgeSearch,
} from "./search";
export {
	createKnowledgeStore,
	type KnowledgeStore,
	LOCAL_ONLY_BYTES,
} from "./store";
