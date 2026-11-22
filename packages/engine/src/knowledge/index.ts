/**
 * Knowledge: a project's files an agent may read, outside the repository.
 * The Space has them (ADR 4): a document lists them by hash, the content
 * travels by hash through the Space's Host, and each Device's folder is a
 * working copy that a reconcile keeps in step before and after each step.
 *
 * `createKnowledge` is the one door. The rest here is what the door's
 * interface writes, and what the run's log and the Host contract share.
 */

export type { KnowledgeFile, KnowledgeText } from "./files";
export { createKnowledge, createRunLearnings } from "./knowledge";
export type { Knowledge } from "./knowledge-door";
export type { AskLearner, WaitingLearning } from "./learnings";
export type { KnowledgeMap } from "./map";
export type { LinkLook } from "./readers";
export {
	type AskedQuestion,
	type KnowledgeQuestion,
	type KnowledgeUseReport,
	stepSources,
} from "./review";
export {
	DEFAULT_EMBEDDING_MODEL,
	type KnowledgeEvaluation,
	type KnowledgeHit,
	type KnowledgeMeaningStatus,
	measuredMeaning,
} from "./search";
export {
	createKnowledgeFolderLocks,
	type KnowledgeFolderLocks,
} from "./sync";
