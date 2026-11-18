/**
 * An answer to a Gate on this phone: the options to choose from, the bar
 * that sends the answer, the check that it is you, what went out, and why
 * an answer did not go.
 */

export {
	type AnswerBar,
	type GateQueue,
	SendSection,
	useQueueBar,
} from "./answer-bar";
export { ChoiceSection } from "./choice-section";
export { ProblemRow } from "./problem-row";
export { SentSection } from "./sent-section";
export {
	type GoneRefusal,
	type SentAnswer,
	useGateAnswer,
} from "./use-gate-answer";
