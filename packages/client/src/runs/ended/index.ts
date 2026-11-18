/** What a run that ended offers: its report, "Was this run useful?", and Ask why. */

export { type AskWhy, askWhy, askWhyAnswer } from "./ask-why";
export { askWhyMutation, explainRun } from "./explain";
export { runReport } from "./report";
export {
	knownUseful,
	rememberedUseful,
	rememberUseful,
	USEFUL_ERROR,
	USEFUL_HINT,
	USEFUL_QUESTION,
	usefulLabel,
	usefulView,
} from "./useful";
