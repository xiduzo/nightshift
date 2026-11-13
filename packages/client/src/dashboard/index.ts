/** The dashboard: its query, computed on the server, the reader's clock, and its view types. */

export {
	CONSOLE_METRICS,
	type ConsoleMetric,
	type ConsoleValues,
	consoleValues,
	daysOf,
} from "./console";
export { dayLabel } from "./day-label";
export { type NodeLadder, nodeLadderLabel } from "./ladders";
export { createDashboardQueries, readerTimeZone } from "./queries";
export {
	type CostSteadiness,
	savingKindOf,
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
