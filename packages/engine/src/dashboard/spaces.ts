import type { SpaceFlows } from "../flows";
import type { SpaceEngine } from "../run";
import { ownEndedRuns, summarizeChanges } from "./changes";
import { lastDays } from "./clock";
import { MOVE_RUNS, nextMoves } from "./moves";
import { summarizeSpend } from "./spend";
import { summarizeDashboard } from "./summary";
import {
	type DashboardSummary,
	type FlowChanges,
	type FlowSignal,
	NIGHT_RANGES,
	type NightRange,
	type SpaceSpend,
} from "./types";
import { turnedSevere, watchRunsOf } from "./watch";

/** The days of help cost the Spend page reads: its longest range. A month is shorter. */
const HELP_DAYS = Math.max(...NIGHT_RANGES);

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
	space: Pick<SpaceEngine, "listRuns"> &
		// Without it, the spend has no help cost: a reader of the runs only.
		Partial<Pick<SpaceEngine, "listAnswerCosts">>,
	read: DashboardRead,
): Promise<SpaceSpend> {
	// The longest range and this month both start within these days.
	const since = lastDays(HELP_DAYS, read.now, read.timeZone)[0];
	const [runs, help] = await Promise.all([
		space.listRuns(),
		space.listAnswerCosts?.(since) ?? [],
	]);
	return summarizeSpend(runs, { ...read, help });
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

/** A flow that turned severe under Needs a look, and the run that turned it. */
export type SevereTurn = {
	projectId: string;
	/** The flow's name. */
	flow: string;
	/** The run whose end turned it severe: the newest that shows it. */
	runId: string;
	/** The severe signal. */
	signal: FlowSignal;
};

/**
 * Whether the end of one run turned its flow severe under Needs a look:
 * the same watch as the dashboard, over the flow's own real runs. Null
 * for a quick run, a test run, a run this Replica does not have, and a
 * flow that was severe already or is not severe now.
 */
export async function flowTurnedSevere(
	space: Pick<SpaceEngine, "listRuns" | "getRun">,
	runId: string,
	now: number,
): Promise<SevereTurn | null> {
	const run = await space.getRun(runId).catch(() => null);
	if (!run?.flowName) return null;
	const runs = watchRunsOf(
		run.flowName,
		await space.listRuns({ projectId: run.projectId }),
		now,
	);
	const signal = turnedSevere(runs, runId);
	return signal
		? { projectId: run.projectId, flow: run.flowName, runId, signal }
		: null;
}
