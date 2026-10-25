/** The dashboard: its numbers, computed from the runs, over one project or all of them. */

export { isTimeZone } from "./clock";
export { summarizeFlow } from "./flow-health";
export { projectDashboard, spacesDashboard } from "./spaces";
export type {
	DashboardSummary,
	FlowHealthDetail,
} from "./types";
