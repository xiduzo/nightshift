/** The dashboard: its query, computed on the server, the reader's clock, and its view types. */

export {
	CONSOLE_METRICS,
	type ConsoleMetric,
	type ConsoleValues,
	consoleNumbers,
	consoleValues,
	daysOf,
	neededShare,
} from "./console";
export { dayLabel } from "./day-label";
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
export {
	type CostSteadiness,
	savingTitle,
	savingWhy,
	steadinessHint,
	steadinessLabel,
	timesUsual,
} from "./spend";
export type {
	DashboardSummary,
	FlowHealthRow,
	FlowRange,
	FlowReport,
	FlowRun,
	GateState,
	NightRange,
	NightsRange,
	SpaceSpend,
	SpendDays,
	SpendFlow,
	SpendSaving,
	Spread,
} from "./types";
export {
	type AttentionCause,
	againstBefore,
	causeLabel,
	FLOW_LEVELS,
	type FlowLevel,
	type FlowSignal,
	type FlowWatch,
	flowLevelHint,
	flowLevelLabel,
	signalFacts,
	signalId,
	signalScale,
	signalTitle,
	type WatchedFlow,
} from "./watch";
