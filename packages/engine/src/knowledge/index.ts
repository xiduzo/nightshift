/**
 * Knowledge: a project's files an agent may read, outside the repository.
 * The Space has them (ADR 4): a document lists them by hash, the content
 * travels by hash through the Space's Host, and each Device's folder is a
 * working copy that a reconcile keeps in step before and after each step.
 */

export { LOCAL_ONLY_BYTES } from "./documents";
export {
	evaluateKnowledge,
	type KnowledgeEvaluation,
} from "./evaluate";
export {
	KNOWLEDGE_FILES_WARNING,
	type KnowledgeFile,
	type KnowledgeText,
} from "./folder";
export {
	createKnowledgeDocuments,
	type KnowledgeDocuments,
} from "./knowledge-document";
export { isLearningsFolder } from "./learnings";
export { ollamaMeaning } from "./meaning";
export {
	createProjectKnowledge,
	type KnowledgeRequest,
	type KnowledgeUseEvent,
	type ProjectKnowledge,
} from "./project-knowledge";
export { type KnowledgeQuestion, questionKey } from "./questions";
export {
	createKnowledgeSearch,
	type KnowledgeHit,
	type KnowledgeMeaningStatus,
	type KnowledgeSearch,
} from "./search";
export {
	type AskedQuestion,
	askedQuestions,
	type KnowledgeSource,
	type KnowledgeUseReport,
	knowledgeFileUse,
	knowledgeUseEvent,
	logKnowledgeUse,
	stepSources,
} from "./use";
