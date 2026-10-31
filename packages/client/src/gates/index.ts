/** Gates that wait for a person: the inbox query, the answer, how long a Gate waited, the words of a deadline, what a question shows (and as plain text), where each choice leads, and their view types. */

export {
	answerGate,
	type GateAnswer,
	type GateAnswerResult,
	type GateRefusal,
	gateRefusalText,
	leavesInbox,
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
} from "./ask";
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
export { type ChoiceRoute, choiceRoutes } from "./routes";
export type { GateChoice, OpenGate } from "./types";
