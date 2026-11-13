/** The dashboard: its numbers, computed from the runs, over one project or all of them. */

export { isTimeZone } from "./clock";
export { summarizeFlow } from "./flow-health";
export {
	flowChanges,
	projectDashboard,
	spaceSpend,
	spacesDashboard,
} from "./spaces";
export {
	CHANGE_TRENDS,
	CHANGE_VERDICTS,
	COST_STEADINESS,
	type DashboardSummary,
	type FlowChanges,
	type FlowHealthDetail,
	MOVE_GUARDS,
	MOVE_SETUP_CAUSES,
	SAVING_KINDS,
	type SpaceSpend,
} from "./types";
