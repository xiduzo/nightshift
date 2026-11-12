/** Gates that wait for a person: the inbox query, the Gate queue (urgency, its words, the one order, which Gates you may answer), the brief as parts, the answer and when it may go, how long a Gate waited, the words of a deadline, what a question shows (and as plain text), where each choice leads and what an answer does, and their view types. */

export {
	type AnswerDraft,
	answerGate,
	type GateAnswer,
	type GateAnswerResult,
	type GateRefusal,
	gateRefusalText,
	leavesInbox,
	maySend,
	unreachableAnswerText,
} from "./answer";
export {
	type AskOption,
	type AskValue,
	type AskValues,
	askAnswerOf,
	askFormFields,
	askOptions,
	askStartValues,
	phoneCanAnswer,
} from "./ask";
export {
	type BriefView,
	briefView,
	choiceLine,
	WRITTEN_BY_NIGHT_SHIFT,
} from "./brief";
export { deadlineSoon, deadlineText, deadlineWhen } from "./deadline";
export {
	gateRun,
	waitedText,
	waitingForYou,
} from "./inbox";
export type { GateLink } from "./links";
export { plainText } from "./plain-text";
export { createGateMutations, createGateQueries } from "./queries";
export { type ContextItem, gateParts, parseGateQuestion } from "./question";
export { gateOrder, mayAnswer, URGENCY_LABEL, urgencyOf } from "./queue";
export {
	type ChoiceRoute,
	choiceRoutes,
	confirmText,
	isDestructive,
	needsConfirm,
	routeNote,
	routeText,
	sentText,
} from "./routes";
export type { AnsweredGate, GateChoice, OpenGate } from "./types";
