/**
 * The sync of a project's knowledge folder with the Space (ADR 4): the
 * reconcile, the holds of the steps, a move, and the collection and the
 * measure of what the Space keeps. `wireSync` binds the use cases to their
 * ports. The daemon keeps one set of folder locks across reloads
 * (`createKnowledgeFolderLocks`).
 */

export type { KnowledgeTimes } from "./adapters/in/knowledge-timers";
export type { KnowledgeDocuments } from "./application/ports";
export {
	createKnowledgeFolderLocks,
	type KnowledgeFolderLocks,
} from "./domain/folder-locks";
export type { KnowledgeReconciled } from "./domain/merge";
export {
	type KnowledgeReconciler,
	type SpaceHostStatus,
	wireSync,
} from "./wire";
