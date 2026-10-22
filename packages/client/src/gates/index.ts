/** Gates that wait for a person: the inbox query, the answer, the inbox order and wait time, what a question shows, and their view types. */

export {
	answerGate,
	type GateAnswer,
	type GateAnswerResult,
	type GateRefusal,
	gateRefusalOf,
	gateRefusalText,
} from "./answer";
export {
	changesInbox,
	gateRun,
	inboxOrder,
	waitedText,
	waitingForYou,
} from "./inbox";
export type { GateLink } from "./links";
export { createGateMutations, createGateQueries } from "./queries";
export { type ContextItem, gateParts, parseGateQuestion } from "./question";
export type { GateChoice, OpenGate } from "./types";
