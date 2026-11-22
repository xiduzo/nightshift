/**
 * The learnings of a project's knowledge: what agents propose, what the
 * look back at runs that ended proposes (ADR 37), and what a person keeps,
 * deletes or tells. `wireLearnings` binds the use cases to their ports.
 */

export type {
	AskLearner,
	LearningsNotifications,
} from "./application/ports";
export type {
	NotePerson,
	ProjectLearning,
	WaitingLearning,
	WaitingNote,
} from "./domain/waiting";
export {
	type FollowRunsDeps,
	type Learnings,
	type RunLearnings,
	wireLearnings,
} from "./wire";
