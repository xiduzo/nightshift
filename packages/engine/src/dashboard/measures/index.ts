/**
 * The dashboard's numbers: pure rules over the runs (`domain/runs.ts` says
 * which fields they read). One domain: every part shares the days, the
 * spreads and the run shapes, so no part of it can stand alone.
 */
export { ownEndedRuns, summarizeChanges } from "./domain/changes";
export {
	CHANGE_TRENDS,
	CHANGE_VERDICTS,
	type FlowChanges,
	MOVE_GUARDS,
	MOVE_SETUP_CAUSES,
} from "./domain/changes-types";
export { isTimeZone, lastDays } from "./domain/clock";
export type { FlowSignal } from "./domain/flow-health-types";
export { NIGHT_RANGES, type NightRange } from "./domain/measure-types";
export { MOVE_RUNS, nextMoves } from "./domain/moves";
export { summarizeSpend } from "./domain/spend";
export {
	COST_STEADINESS,
	SAVING_KINDS,
	type SpaceSpend,
} from "./domain/spend-types";
export { summarizeDashboard } from "./domain/summary";
export type { DashboardSummaryOf } from "./domain/summary-types";
export { turnedSevere, watchRunsOf } from "./domain/watch";
