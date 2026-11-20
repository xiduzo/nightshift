/** The dashboard: its numbers, computed from the runs, over one project or all of them. */

export {
	CHANGE_TRENDS,
	CHANGE_VERDICTS,
	type FlowChanges,
	MOVE_GUARDS,
	MOVE_SETUP_CAUSES,
} from "./domain/changes-types";
export { isTimeZone } from "./domain/clock";
export { summarizeFlow } from "./domain/flow-health";
export type { FlowHealthDetail } from "./domain/flow-health-types";
export {
	COST_STEADINESS,
	SAVING_KINDS,
	type SpaceSpend,
} from "./domain/spend-types";
export type { DashboardSummary } from "./domain/summary-types";
export {
	flowChanges,
	flowTurnedSevere,
	projectDashboard,
	type SevereTurn,
	spaceSpend,
	spacesDashboard,
} from "./spaces";
