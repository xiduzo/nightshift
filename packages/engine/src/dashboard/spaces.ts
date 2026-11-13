import type { SpaceFlows } from "../flows";
import type { SpaceEngine } from "../run";
import { ownEndedRuns, summarizeChanges } from "./changes";
import { lastDays } from "./clock";
import { MOVE_RUNS, nextMoves } from "./moves";
import { summarizeSpend } from "./spend";
import { summarizeDashboard } from "./summary";
import type {
	DashboardSummary,
	FlowChanges,
	NightRange,
	SpaceSpend,
} from "./types";

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

/** The Spend page of a Space: what its runs cost, and where a change saves. */
export async function spaceSpend(
	space: Pick<SpaceEngine, "listRuns">,
	read: DashboardRead,
): Promise<SpaceSpend> {
	return summarizeSpend(await space.listRuns(), read);
}

/**
 * Before and after for one flow of a project over the last `nights` days:
 * its runs and its changes, and the next changes to try, read from the
 * steps of its newest runs of the days. A flow without revisions (a
 * removed one) has no changes.
 */
export async function flowChanges(
	space: Pick<SpaceEngine, "listRuns" | "getRun"> & {
		flows: Pick<SpaceFlows, "revisions">;
	},
	flow: { projectId: string; name: string; nights: NightRange },
	read: DashboardRead,
): Promise<FlowChanges> {
	const [all, revisions] = await Promise.all([
		space.listRuns({ projectId: flow.projectId }),
		(async () => space.flows.revisions(flow.projectId, flow.name))().catch(
			() => [],
		),
	]);
	const runs = ownEndedRuns(flow.name, all);
	const start = lastDays(flow.nights, read.now, read.timeZone)[0] ?? read.now;
	const recent = runs.filter((run) => run.createdAt >= start).slice(-MOVE_RUNS);
	const details = (
		await Promise.allSettled(recent.map((run) => space.getRun(run.id)))
	).flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
	return summarizeChanges(runs, revisions, {
		...read,
		nights: flow.nights,
		moves: nextMoves(details),
		read: details.length,
	});
}
