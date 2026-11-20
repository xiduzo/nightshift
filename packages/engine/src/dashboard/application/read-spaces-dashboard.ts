import type { Actor } from "../../contract";
import { summarizeDashboard } from "../measures";
import type { DashboardProjects, DashboardRuns } from "./ports";
import type { DashboardSummary } from "./read-project-dashboard";

export type ReadSpacesDashboardPorts = {
	runs: Pick<DashboardRuns, "list">;
	projects: DashboardProjects;
};

/**
 * The dashboard of every project of these Spaces: all their runs, grouped
 * by project. The door says which Spaces the actor is in.
 */
export const readSpacesDashboard =
	(ports: ReadSpacesDashboardPorts) =>
	async (
		actor: Actor,
		request: { spaceIds: readonly string[]; now: number; timeZone: string },
	): Promise<DashboardSummary> => {
		const { spaceIds, now, timeZone } = request;
		const [runs, projects] = await Promise.all([
			Promise.all(
				spaceIds.map((spaceId) => ports.runs.list(actor, { spaceId })),
			),
			Promise.all(
				spaceIds.map((spaceId) => ports.projects.list(actor, { spaceId })),
			),
		]);
		const projectNames = new Map(
			projects.flat().map((project) => [project.id, project.name]),
		);
		return summarizeDashboard(runs.flat(), {
			now,
			timeZone,
			scope: { kind: "all", projectNames },
		});
	};
