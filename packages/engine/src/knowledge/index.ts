/**
 * Knowledge: a project's files an agent may read, outside the repository.
 * The Space has them (ADR 4): a document lists them by hash, the content
 * travels by hash through the Space's Host, and each Device's folder is a
 * working copy that a reconcile keeps in step before and after each step.
 *
 * `createKnowledge` is the one door. The rest here is what the door's
 * interface writes, and what the run's log and the Host contract share.
 */

export { LOCAL_ONLY_BYTES } from "./documents";
export { DEFAULT_EMBEDDING_MODEL } from "./embedding-model";
export type { KnowledgeEvaluation } from "./evaluate";
export type { KnowledgeText } from "./folder";
export {
	createKnowledgeFolderLocks,
	type KnowledgeFolderLocks,
} from "./folder-locks";
export type { KnowledgeFile } from "./folder-snapshot";
export { createKnowledge, type Knowledge } from "./knowledge";
export type { WaitingLearning } from "./learnings";
export type { KnowledgeMap } from "./map";
export { type KnowledgeMeaning, ollamaMeaning } from "./meaning";
export type { KnowledgeQuestion } from "./questions";
export type { KnowledgeHit, KnowledgeMeaningStatus } from "./search";
export { knowledgeSourceProblems, type SourceProblem } from "./sources";
export type { KnowledgeRequest, KnowledgeUseEvent } from "./step-knowledge";
export {
	type AskedQuestion,
	type KnowledgeSource,
	type KnowledgeUseReport,
	knowledgeUseEvent,
	stepSources,
} from "./use";
