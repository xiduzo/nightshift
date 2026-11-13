/** The dashboard: its query, computed on the server, the reader's clock, and its view types. */

export {
	changeSummary,
	type MoveTone,
	moveAsk,
	moveKindOf,
	moveStep,
	moveText,
	moveTone,
	moveToneLabel,
	verdictLabel,
} from "./changes";
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
	savingAsk,
	savingKindOf,
	savingTitle,
	savingWhy,
	steadinessHint,
	steadinessLabel,
	timesUsual,
} from "./spend";
export type {
	ChangeMeasure,
	ChangeTrend,
	DashboardSummary,
	FlowChanges,
	FlowHealthRow,
	FlowMove,
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
	againstBefore,
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
