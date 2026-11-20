/**
 * The dashboard: its numbers, computed from the runs, over one project, a
 * Space or several Spaces. The rules are in `measures/`. `wireDashboard`
 * binds the use cases of `Engine.dashboard`.
 */

export type { DashboardSummary } from "./application/read-project-dashboard";
export type { SevereTurn } from "./application/read-severe-turn";
export {
	CHANGE_TRENDS,
	CHANGE_VERDICTS,
	COST_STEADINESS,
	type FlowChanges,
	type FlowHealthDetail,
	isTimeZone,
	MOVE_GUARDS,
	MOVE_SETUP_CAUSES,
	SAVING_KINDS,
	type SpaceSpend,
	summarizeSpend,
} from "./measures";
export { type Dashboard, wireDashboard } from "./wire";
