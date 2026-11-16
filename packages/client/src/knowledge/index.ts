/** Knowledge: the query options of a project's knowledge, Keep and Delete of a learning or of one note, what a told link becomes, and the rules both apps follow for what waits. */

export {
	ASK_A_MEMBER,
	canKeep,
	learningKey,
	type WaitingLearning,
} from "./learnings";
export { createKnowledgeQueries } from "./queries";
export { arrangeTasks, type ReviewTask, taskLine } from "./review";
export {
	agentSource,
	type HowMuch,
	type HowOften,
	type LinkLook,
	type LinkPlan,
	linkPlan,
	linksIn,
	readSource,
	type ToldSource,
	toldNote,
} from "./told-links";
export { type NoteToCheck, useCheckNotes } from "./use-check-notes";
export { type SettleFailure, useSettleLearnings } from "./use-settle";
