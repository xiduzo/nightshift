/**
 * The knowledge sources: the flows that fill a project's knowledge, as the
 * Knowledge page lists, saves, removes and syncs them in the Space of each
 * request. `wireSources` binds the use cases to their ports.
 */

export type { SourcesSpace } from "./application/ports";
export type { KnowledgeSync } from "./domain/syncs";
export { type Sources, wireSources } from "./wire";
