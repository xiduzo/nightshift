/** Gates that wait for a person: the inbox query, the answer, the inbox order and wait time, what a question shows, where each choice leads, and their view types. */

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
	gateRun,
	inboxOrder,
	waitedText,
	waitingForYou,
} from "./inbox";
export type { GateLink } from "./links";
export { createGateMutations, createGateQueries } from "./queries";
export { type ContextItem, gateParts, parseGateQuestion } from "./question";
export { type ChoiceRoute, choiceRoutes } from "./routes";
export type { GateChoice, OpenGate } from "./types";
