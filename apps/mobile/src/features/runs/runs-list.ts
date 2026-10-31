import {
	costLabel,
	flowLabel,
	hasEnded,
	type RunStatus,
	type RunSummary,
} from "@nightshift/client";

import { matches, queryWords } from "@/shared/match";

/**
 * The Runs tab without React Native: its status chips and their counts,
 * the runs a chip and a search show, the nights that group them, and the
 * line under each run.
 */

/** The status chips over the list of runs. */
export type RunFilter =
	| "all"
	| "running"
	| "needs-you"
	| "failed"
	| "stopped"
	| "finished";

/** The chips, in the order they show. */
export const RUN_FILTERS: readonly { key: RunFilter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "running", label: "Running" },
	{ key: "needs-you", label: "Needs you" },
	{ key: "failed", label: "Failed" },
	{ key: "stopped", label: "Stopped" },
	{ key: "finished", label: "Finished" },
];

/** The statuses each chip shows. A sleeping run is on its way: it runs. An interrupted run stopped before its work was done. */
const STATUSES: Record<Exclude<RunFilter, "all">, readonly RunStatus[]> = {
	running: ["running", "sleeping"],
	"needs-you": ["waiting"],
	failed: ["failed"],
	stopped: ["stopped", "interrupted"],
	finished: ["finished"],
};

/** The filter of a link (`/runs?filter=failed`). Anything else shows every run. */
export function runFilterOf(value: string | string[] | undefined): RunFilter {
	const key = Array.isArray(value) ? value[0] : value;
	return RUN_FILTERS.some((filter) => filter.key === key)
		? (key as RunFilter)
		: "all";
}

/** Whether a run with this status shows under the filter. */
export function inFilter(status: RunStatus, filter: RunFilter): boolean {
	return filter === "all" || STATUSES[filter].includes(status);
}

function noCounts(): Record<RunFilter, number> {
	return {
		all: 0,
		running: 0,
		"needs-you": 0,
		failed: 0,
		stopped: 0,
		finished: 0,
	};
}

/** How many runs each chip shows. */
export function filterCounts(
	runs: readonly Pick<RunSummary, "status">[],
): Record<RunFilter, number> {
	const counts = noCounts();
	for (const run of runs) {
		for (const { key } of RUN_FILTERS) {
			if (inFilter(run.status, key)) counts[key] += 1;
		}
	}
	return counts;
}

/** The statuses the Host reads for a chip. None for "All": every run. */
export function filterStatuses(filter: RunFilter): RunStatus[] | undefined {
	return filter === "all" ? undefined : [...STATUSES[filter]];
}

/**
 * How many runs each chip shows, from the run counts of the projects (of
 * one project, or of all when `projectId` is null). Null when the Host
 * sends no counts (an older Host): then the screen counts what it read.
 */
export function countedFilters(
	projects:
		| readonly {
				id: string;
				runs?: { statuses: Partial<Record<RunStatus, number>> };
		  }[]
		| undefined,
	projectId: string | null,
): Record<RunFilter, number> | null {
	if (!projects || projects.some((project) => project.runs === undefined)) {
		return null;
	}
	const counts = noCounts();
	for (const project of projects) {
		if (projectId !== null && project.id !== projectId) continue;
		for (const [status, count] of Object.entries(
			project.runs?.statuses ?? {},
		)) {
			for (const { key } of RUN_FILTERS) {
				if (inFilter(status as RunStatus, key)) counts[key] += count ?? 0;
			}
		}
	}
	return counts;
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

const DAY = 24 * 60 * 60_000;

/** A night starts at noon: a run that starts before noon belongs to the night before. */
const NOON = 12;

const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

function clock(at: number): string {
	const date = new Date(at);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The evening a moment belongs to, as the local midnight that starts that day. */
function eveningOf(at: number): Date {
	const date = new Date(at);
	const day = date.getHours() < NOON ? date.getDate() - 1 : date.getDate();
	return new Date(date.getFullYear(), date.getMonth(), day);
}

/**
 * The night a run started in, in local time. A night runs from noon to
 * the next noon: "Today" since noon today, "Last night" from noon
 * yesterday, then "Thursday night" for the week before, then "Night of
 * 24 October".
 */
export function nightLabel(startedAt: number, now: number): string {
	const today = new Date(now);
	const noonToday = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate(),
		NOON,
	).getTime();
	if (startedAt >= noonToday) return "Today";
	const evening = eveningOf(startedAt);
	const startOfToday = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate(),
	).getTime();
	const days = Math.round((startOfToday - evening.getTime()) / DAY);
	if (days <= 1) return "Last night";
	if (days < 7) return `${WEEKDAYS[evening.getDay()]} night`;
	const year =
		evening.getFullYear() === today.getFullYear()
			? ""
			: ` ${evening.getFullYear()}`;
	return `Night of ${evening.getDate()} ${MONTHS[evening.getMonth()]}${year}`;
}

/** The runs of one night, under its heading. */
export type Night<T> = { label: string; runs: T[] };

/** Runs, newest first, grouped by the night they started in. */
export function byNight<T extends Pick<RunSummary, "createdAt">>(
	runs: readonly T[],
	now: number,
): Night<T>[] {
	const nights: Night<T>[] = [];
	for (const run of runs) {
		const label = nightLabel(run.createdAt, now);
		const last = nights.at(-1);
		if (last?.label === label) last.runs.push(run);
		else nights.push({ label, runs: [run] });
	}
	return nights;
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
	return [run.endedAt !== null ? clock(run.endedAt) : null, costLabel(run)]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

/** The line under a run's title: "website · Feature factory". */
export function runPlace(
	run: Pick<RunSummary, "flowName">,
	projectName: string | null,
): string {
	return [projectName, flowLabel(run)]
		.filter((part): part is string => part !== null && part !== "")
		.join(" · ");
}
