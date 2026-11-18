/** The dashboard: its numbers, computed from the runs, over one project or all of them. */

export {
	CHANGE_TRENDS,
	CHANGE_VERDICTS,
	type FlowChanges,
	MOVE_GUARDS,
	MOVE_SETUP_CAUSES,
} from "./changes-types";
export { isTimeZone } from "./clock";
export { summarizeFlow } from "./flow-health";
export type { FlowHealthDetail } from "./flow-health-types";
export {
	flowChanges,
	flowTurnedSevere,
	projectDashboard,
	type SevereTurn,
	spaceSpend,
	spacesDashboard,
} from "./spaces";
export { COST_STEADINESS, SAVING_KINDS, type SpaceSpend } from "./spend-types";
export type { DashboardSummary } from "./summary-types";
