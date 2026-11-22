/**
 * The Map of a project's knowledge: the files, the topics they share, the
 * files close in meaning, the questions that found them and the learnings
 * that name their topics, and the words people marked as not a topic.
 * `wireMap` binds the use cases to their ports.
 */

export {
	type KnowledgeMap,
	learningNode,
	questionNode,
} from "./domain/map";
export { wireMap } from "./wire";
