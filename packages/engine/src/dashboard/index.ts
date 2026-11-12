/** The dashboard: its numbers, computed from the runs, over one project or all of them. */

export { isTimeZone } from "./clock";
export { summarizeFlow } from "./flow-health";
export { projectDashboard, spaceSpend, spacesDashboard } from "./spaces";
export {
	COST_STEADINESS,
	type DashboardSummary,
	type FlowHealthDetail,
	SAVING_KINDS,
	type SpaceSpend,
} from "./types";
