/**
 * The review of a project's knowledge: what waits for a person on the
 * Knowledge page, the question set, and how agents use the files (from the
 * event log). `wireReview` binds the use cases to their ports.
 */

export type { ReviewTask } from "./application/list-review-tasks";
export { type KnowledgeQuestion, parseQuestions } from "./domain/questions";
export {
	type AskedQuestion,
	type KnowledgeUseReport,
	stepSources,
} from "./domain/use";
export { wireReview } from "./wire";
