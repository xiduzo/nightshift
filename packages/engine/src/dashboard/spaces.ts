import type { SpaceFlows } from "../flows";
import type { SpaceEngine } from "../run";
import { summarizeDashboard } from "./summary";
import type { DashboardSummary } from "./types";

/** When the dashboard is read, and the reader's time zone (IANA). */
export type DashboardRead = { now: number; timeZone: string };

/** The dashboard of one project of a Space: its runs, grouped by flow. */
export async function projectDashboard(
	space: Pick<SpaceEngine, "listRuns"> & { flows: Pick<SpaceFlows, "list"> },
	projectId: string,
	read: DashboardRead,
): Promise<DashboardSummary> {
	const [runs, flows] = await Promise.all([
		space.listRuns({ projectId }),
		space.flows.list(projectId),
	]);
	return summarizeDashboard(runs, {
		...read,
		scope: { kind: "project", flows: flows.map((flow) => flow.name) },
	});
}

/**
 * The dashboard of every project of these Spaces: all their runs, grouped
 * by project.
 */
export async function spacesDashboard(
	spaces: readonly Pick<SpaceEngine, "listRuns" | "listProjects">[],
	read: DashboardRead,
): Promise<DashboardSummary> {
	const [runs, projects] = await Promise.all([
		Promise.all(spaces.map((space) => space.listRuns())),
		Promise.all(spaces.map((space) => space.listProjects())),
	]);
	const projectNames = new Map(
		projects.flat().map((project) => [project.id, project.name]),
	);
	return summarizeDashboard(runs.flat(), {
		...read,
		scope: { kind: "all", projectNames },
	});
}
