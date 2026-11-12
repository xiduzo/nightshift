/** The dashboard: its query, computed on the server, the reader's clock, and its view types. */

export {
	CONSOLE_METRICS,
	type ConsoleMetric,
	type ConsoleValues,
	changeOf,
	consoleNumbers,
	consoleValues,
	daysOf,
	neededShare,
} from "./console";
export { dayLabel } from "./day-label";
export { shortReason } from "./failing";
export {
	decisionsText,
	type LadderPart,
	type LadderSummary,
	ladderParts,
	landedText,
	type NodeLadder,
	nodeLadderLabel,
	shareText,
	unsureText,
} from "./ladders";
export { neededReasonLabel, neededReasonsText } from "./needed";
export { createDashboardQueries, readerTimeZone } from "./queries";
export type {
	DashboardSummary,
	FailingFlow,
	FlowHealthRow,
	FlowRange,
	FlowReport,
	FlowRun,
	GateState,
	NightRange,
	NightsRange,
	Spread,
} from "./types";
