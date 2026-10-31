import {
	hasEnded,
	type RunStatus,
	type RunSummary,
	runStatusLabel,
	waitedText,
	whenLabel,
	workedSoFar,
} from "@nightshift/client";

/**
 * The Runs tab without React Native: its filter chips and their counts,
 * the runs a filter shows, and what each row says at its end.
 */

/** The chips over the list of runs. */
export type RunFilter = "all" | "running" | "needs-you" | "failed" | "finished";

/** The chips, in the order they show. */
export const RUN_FILTERS: readonly { key: RunFilter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "running", label: "Running" },
	{ key: "needs-you", label: "Needs you" },
	{ key: "failed", label: "Failed" },
	{ key: "finished", label: "Finished" },
];

/** The statuses each chip shows. A sleeping run is on its way: it runs. An interrupted run ended in trouble, as a failed one did. */
const STATUSES: Record<Exclude<RunFilter, "all">, readonly RunStatus[]> = {
	running: ["running", "sleeping"],
	"needs-you": ["waiting"],
	failed: ["failed", "interrupted"],
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

/** How many runs each chip shows. */
export function filterCounts(
	runs: readonly Pick<RunSummary, "status">[],
): Record<RunFilter, number> {
	const counts: Record<RunFilter, number> = {
		all: 0,
		running: 0,
		"needs-you": 0,
		failed: 0,
		finished: 0,
	};
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
	const counts: Record<RunFilter, number> = {
		all: 0,
		running: 0,
		"needs-you": 0,
		failed: 0,
		finished: 0,
	};
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

/** The runs of one project, or of every project when `projectId` is null. */
export function ofProject<T extends Pick<RunSummary, "projectId">>(
	runs: readonly T[],
	projectId: string | null,
): T[] {
	return projectId === null
		? [...runs]
		: runs.filter((run) => run.projectId === projectId);
}

/** The runs a filter shows, newest first. */
export function filterRuns<T extends Pick<RunSummary, "status" | "createdAt">>(
	runs: readonly T[],
	filter: RunFilter,
): T[] {
	return runs
		.filter((run) => inFilter(run.status, filter))
		.sort((a, b) => b.createdAt - a.createdAt);
}

/** How many runs the list reads at first, and how many more it reads each time you scroll near the end. */
export const RUNS_PAGE = 30;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function clock(at: Date): string {
	return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

function startOfDay(at: Date): number {
	return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** When a run started, short enough for the end of a row: "09:41", "Yesterday", "3 Oct". */
export function startedShort(at: number, now: number): string {
	const date = new Date(at);
	const days = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / DAY);
	if (days <= 0) return clock(date);
	if (days === 1) return "Yesterday";
	return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * What a run's row shows at its end, and how a screen reader says it. A
 * run that waits: how long its Gate has waited. A run on its way: how long
 * it has worked, without the time it slept or waited. An ended run: when
 * it started.
 */
export function rowValue(
	run: Pick<RunSummary, "status" | "createdAt" | "gates" | "sleeps">,
	now: number,
): { value: string; valueLabel: string } {
	if (run.status === "waiting") {
		const open = run.gates
			.filter((gate) => gate.closedAt === null)
			.reduce<number | null>(
				(oldest, gate) =>
					oldest === null ? gate.openedAt : Math.min(oldest, gate.openedAt),
				null,
			);
		if (open !== null) {
			const waited = waitedText(now - open);
			return { value: waited, valueLabel: `waited ${waited}` };
		}
	}
	if (!hasEnded(run.status)) {
		const took = waitedText(workedSoFar(run, now));
		return { value: took, valueLabel: `${took} so far` };
	}
	return {
		value: startedShort(run.createdAt, now),
		valueLabel: `started ${whenLabel(run.createdAt, now)}`,
	};
}

/** The line under the title: "website · Newest first · 12 runs". */
export function runsSummary(count: number, projectName: string | null): string {
	return [projectName, "Newest first", count === 1 ? "1 run" : `${count} runs`]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

/** What the list says when a filter shows no run. */
export function emptyFilterTitle(filter: Exclude<RunFilter, "all">): string {
	switch (filter) {
		case "running":
			return "No run is on its way";
		case "needs-you":
			return "No run needs you";
		case "failed":
			return "No failed runs";
		case "finished":
			return "No finished runs";
	}
}

/** What a screen reader says for a run's row: "Running, Feature factory · WEB-142, website, 12 min so far". */
export function runRowLabel(
	run: Pick<RunSummary, "status" | "title">,
	projectName: string | null,
	valueLabel: string,
): string {
	return [runStatusLabel(run.status), run.title, projectName, valueLabel]
		.filter((part): part is string => part !== null && part.trim() !== "")
		.join(", ");
}
