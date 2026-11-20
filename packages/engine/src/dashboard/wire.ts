import type {
	AnswerCosts,
	DashboardFlows,
	DashboardProjects,
	DashboardRuns,
} from "./application/ports";
import { readFlowChanges } from "./application/read-flow-changes";
import { readFlowHealth } from "./application/read-flow-health";
import { readProjectDashboard } from "./application/read-project-dashboard";
import { readSevereTurn } from "./application/read-severe-turn";
import { readSpaceSpend } from "./application/read-space-spend";
import { readSpacesDashboard } from "./application/read-spaces-dashboard";

/** What the engine's composition fills: every port of the dashboard comes from another slice. */
export type DashboardDeps = {
	runs: DashboardRuns;
	flows: DashboardFlows;
	projects: DashboardProjects;
	answerCosts: AnswerCosts;
};

/** The dashboard's use cases, bound to their ports (`Engine.dashboard`). */
export function wireDashboard(deps: DashboardDeps) {
	return {
		readProjectDashboard: readProjectDashboard(deps),
		readSpacesDashboard: readSpacesDashboard(deps),
		readSpaceSpend: readSpaceSpend(deps),
		readFlowChanges: readFlowChanges(deps),
		readFlowHealth: readFlowHealth(deps),
		readSevereTurn: readSevereTurn(deps),
	};
}

/** The dashboard's use cases (`wireDashboard`). */
export type Dashboard = ReturnType<typeof wireDashboard>;
