/**
 * Gates on this phone. The Needs-you inbox: the open Gates of every Space
 * you are in. One Gate in full to answer it, with its links, its actions
 * and its run's transcript. And Needs you: the queue of everything that
 * waits for you, with the bar above the tabs that sends your answer.
 */

export { GateActionsScreen, useShareTakeOver } from "./actions";
export { GateAnswerScreen, GateLinkScreen } from "./briefing";
export { gateRowText } from "./inbox";
export {
	NeedsScreen,
	needsTabLabel,
	useNeedsAccessory,
	useNeedsCount,
} from "./needs";
export { TranscriptScreen } from "./transcript";
