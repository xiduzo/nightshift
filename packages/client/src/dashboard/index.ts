/** The dashboard: its query, computed on the server, the reader's clock, and its view types. */

export { daysOf } from "./days";
export {
	againstBefore,
	changeSummary,
	type FlowLevel,
	type FlowSignal,
	type FlowWatch,
	flowLevelHint,
	flowLevelLabel,
	type MoveTone,
	moveKindOf,
	moveStep,
	moveText,
	moveTone,
	moveToneLabel,
	nodeLadderLabel,
	signalFacts,
	signalId,
	signalScale,
	signalTitle,
	verdictLabel,
	type WatchedFlow,
} from "./health";
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
	ChangeMeasure,
	ChangeTrend,
	DashboardSummary,
	FlowChanges,
	FlowHealthRow,
	FlowMove,
	FlowReport,
	NightRange,
	NightsRange,
	SpaceSpend,
	SpendDays,
	SpendFlow,
	SpendSaving,
	Spread,
} from "./types";
