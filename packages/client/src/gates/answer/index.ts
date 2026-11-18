/** The answer to a Gate: the draft and when it may go, the form of an Ask, where each choice leads, what a refusal says, and what an answer does. */

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
	type ChoiceRoute,
	choiceRoutes,
	confirmText,
	isDestructive,
	needsConfirm,
	routeNote,
	routeText,
	sentText,
} from "./routes";
