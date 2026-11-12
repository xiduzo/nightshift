import {
	costLabel,
	dayLabel,
	flowLabel,
	groupCounts,
	groupStatuses,
	hasEnded,
	isTestRun,
	type RunGroup,
	type RunStatus,
	type RunSummary,
	statusOf,
	TEST_RUN_LABEL,
	tokensLabel,
	wall,
} from "@nightshift/client";

import { matches, queryWords } from "@/shared/match";

/**
 * The Runs tab without React Native: its status chips and their counts,
 * the runs a chip and a search show, the days that group them, and the
 * line under each run.
 */

/**
 * The status chips over the list of runs: every run, or one group
 * (`statusOf`), the same groups Watch counts.
 */
export type RunFilter = "all" | RunGroup;

/** The chips, in the order they show. */
export const RUN_FILTERS: readonly { key: RunFilter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "running", label: "Running" },
	{ key: "needs-you", label: "Needs you" },
	{ key: "failed", label: "Failed" },
	{ key: "stopped", label: "Stopped" },
	{ key: "finished", label: "Finished" },
];

/** The filter of a link (`/runs?filter=failed`). Anything else shows every run. */
export function runFilterOf(value: string | string[] | undefined): RunFilter {
	const key = Array.isArray(value) ? value[0] : value;
	return RUN_FILTERS.some((filter) => filter.key === key)
		? (key as RunFilter)
		: "all";
}

/** Whether a run with this status shows under the filter. */
export function inFilter(status: RunStatus, filter: RunFilter): boolean {
	return filter === "all" || statusOf({ status }).group === filter;
}

/** The counts of the chips: every run, then the runs of each group. */
function chipCounts(
	statuses: Readonly<Partial<Record<string, number>>>,
): Record<RunFilter, number> {
	const groups = groupCounts(statuses);
	const all = Object.values(groups).reduce((sum, count) => sum + count, 0);
	return { all, ...groups };
}

/**
 * How many runs each chip shows. A test run shows in the list with its
 * label, but a count leaves it out (`isTestRun`).
 */
export function filterCounts(
	runs: readonly Pick<RunSummary, "status" | "test">[],
): Record<RunFilter, number> {
	const statuses: Partial<Record<RunStatus, number>> = {};
	for (const run of runs) {
		if (isTestRun(run)) continue;
		statuses[run.status] = (statuses[run.status] ?? 0) + 1;
	}
	return chipCounts(statuses);
}

/** The statuses the Host reads for a chip. None for "All": every run. */
export function filterStatuses(filter: RunFilter): RunStatus[] | undefined {
	return filter === "all" ? undefined : groupStatuses(filter);
}

/** How many runs of a project have each status, as the Host counts them. */
type StatusCounts = {
	statuses: Partial<Record<RunStatus, number>>;
	/** The test runs among `statuses`. An older Host sends none. */
	tests?: Partial<Record<RunStatus, number>>;
};

/**
 * How many runs each chip shows, from the run counts of the projects (of
 * one project, or of all when `projectId` is null), without the test
 * runs. Null when the Host sends no counts (an older Host): then the
 * screen counts what it read.
 */
export function countedFilters(
	projects: readonly { id: string; runs?: StatusCounts }[] | undefined,
	projectId: string | null,
): Record<RunFilter, number> | null {
	if (!projects || projects.some((project) => project.runs === undefined)) {
		return null;
	}
	const statuses: Partial<Record<string, number>> = {};
	for (const project of projects) {
		if (projectId !== null && project.id !== projectId) continue;
		const tests = project.runs?.tests ?? {};
		for (const [status, count] of Object.entries(
			project.runs?.statuses ?? {},
		)) {
			const runs = (count ?? 0) - (tests[status as RunStatus] ?? 0);
			statuses[status] = (statuses[status] ?? 0) + runs;
		}
	}
	return chipCounts(statuses);
}

/**
 * How many runs the Space has, test runs too: the list shows them all.
 * Null when the Host sends no counts.
 */
export function spaceRunCount(
	projects: readonly { runs?: { total: number } }[] | undefined,
): number | null {
	if (!projects || projects.some((project) => project.runs === undefined)) {
		return null;
	}
	return projects.reduce((sum, project) => sum + (project.runs?.total ?? 0), 0);
}

/**
 * The runs a list shows, newest first: of one project (every project when
 * `projectId` is null), under the chip, that match the search by their
 * title, flow or project. An older Host sends every run whatever the
 * filter: the screen filters too.
 */
export function shownRuns<
	T extends Pick<
		RunSummary,
		"status" | "createdAt" | "projectId" | "title" | "flowName"
	>,
>(
	runs: readonly T[],
	{
		projectId,
		filter,
		query,
		projectName,
	}: {
		projectId: string | null;
		filter: RunFilter;
		query: string;
		projectName: (projectId: string) => string | undefined;
	},
): T[] {
	const words = queryWords(query);
	return runs
		.filter(
			(run) =>
				(projectId === null || run.projectId === projectId) &&
				inFilter(run.status, filter) &&
				(words.length === 0 ||
					matches(words, [
						run.title,
						run.flowName,
						projectName(run.projectId),
					])),
		)
		.sort((a, b) => b.createdAt - a.createdAt);
}

/** How many runs the list reads at first, and how many more it reads each time you scroll near the end. */
export const RUNS_PAGE = 30;

function clock(at: number): string {
	const shown = wall(at);
	return `${String(shown.hour).padStart(2, "0")}:${String(shown.minute).padStart(2, "0")}`;
}

/** The runs of one day, under its heading. */
export type Day<T> = { label: string; runs: T[] };

/**
 * Runs, newest first, grouped by the day they started in on this phone:
 * "Today", "Yesterday", then the weekday and date.
 */
export function byDay<T extends Pick<RunSummary, "createdAt">>(
	runs: readonly T[],
	now: number,
): Day<T>[] {
	const days: Day<T>[] = [];
	for (const run of runs) {
		const label = dayLabel(run.createdAt, now);
		const last = days.at(-1);
		if (last?.label === label) last.runs.push(run);
		else days.push({ label, runs: [run] });
	}
	return days;
}

/**
 * The line under a run's project and flow, after its status word. A run
 * on its way: since when. A run that waits: since when its oldest open
 * Gate waits. An ended run: when it ended, and its cost when known.
 */
export function runMeta(
	run: Pick<
		RunSummary,
		| "status"
		| "createdAt"
		| "endedAt"
		| "gates"
		| "costUsd"
		| "costMissing"
		| "costCalls"
		| "metrics"
	>,
): string {
	if (run.status === "waiting") {
		const open = run.gates
			.filter((gate) => gate.closedAt === null)
			.reduce<number | null>(
				(oldest, gate) =>
					oldest === null ? gate.openedAt : Math.min(oldest, gate.openedAt),
				null,
			);
		return `since ${clock(open ?? run.createdAt)}`;
	}
	if (!hasEnded(run.status)) return `since ${clock(run.createdAt)}`;
	return [
		run.endedAt !== null ? clock(run.endedAt) : null,
		tokensLabel(run.metrics?.tokens),
		costLabel(run),
	]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

/**
 * The line under a run's title: "website · Feature factory", and
 * "· Test run" for a run started from the editor with pins or skips.
 */
export function runPlace(
	run: Pick<RunSummary, "flowName" | "test">,
	projectName: string | null,
): string {
	return [projectName, flowLabel(run), isTestRun(run) ? TEST_RUN_LABEL : null]
		.filter((part): part is string => part !== null && part !== "")
		.join(" · ");
}
