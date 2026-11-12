import type { RunResult, RunStatus } from "./types";

/**
 * Where a run is, as every screen reads it: its word, the look it takes
 * and the group it counts in. One table for web Home, the phone's Runs
 * chips, Watch and every list of runs. Only the look (icons, colours)
 * stays in each app.
 */

/**
 * The group a run counts in: on its way (running or asleep), waiting
 * for a person, or how it ended. A tile and the chip it opens count the
 * same runs.
 */
export type RunGroup =
	| "running"
	| "needs-you"
	| "failed"
	| "stopped"
	| "finished";

const GROUP_OF: Record<RunStatus, RunGroup> = {
	running: "running",
	// Asleep, the run is on its way: it continues by itself.
	sleeping: "running",
	// A Gate waits: the run counts where the person acts.
	waiting: "needs-you",
	failed: "failed",
	stopped: "stopped",
	// Night Shift stopped during a step: the run stopped before its work was done.
	interrupted: "stopped",
	finished: "finished",
};

const STATUSES = Object.keys(GROUP_OF) as RunStatus[];

/** Whether a run with this status has ended: nothing runs and nothing waits. */
export function hasEnded(status: RunStatus): boolean {
	const group = GROUP_OF[status];
	return group !== "running" && group !== "needs-you";
}

/** The statuses of the runs in these groups, for a list the Host filters. */
export function groupStatuses(...groups: RunGroup[]): RunStatus[] {
	return STATUSES.filter((status) => groups.includes(GROUP_OF[status]));
}

/**
 * How many runs each group holds, from how many runs have each status.
 * A key that is no status counts nowhere.
 */
export function groupCounts(
	counts: Readonly<Partial<Record<string, number>>>,
): Record<RunGroup, number> {
	const groups: Record<RunGroup, number> = {
		running: 0,
		"needs-you": 0,
		failed: 0,
		stopped: 0,
		finished: 0,
	};
	for (const [status, count] of Object.entries(counts)) {
		const group = Object.hasOwn(GROUP_OF, status)
			? GROUP_OF[status as RunStatus]
			: undefined;
		if (group) groups[group] += count ?? 0;
	}
	return groups;
}

const STATUS_LABELS: Record<RunStatus, string> = {
	running: "Running",
	waiting: "Waiting for you",
	sleeping: "Sleeping",
	finished: "Finished",
	stopped: "Stopped",
	failed: "Failed",
	interrupted: "Interrupted",
};

/**
 * A status in words: "Running", "Waiting for you". For a run, read
 * `statusOf`: it knows a run that had nothing to do.
 */
export function runStatusLabel(status: RunStatus): string {
	return STATUS_LABELS[status];
}

/**
 * The look a run takes: its status, or `nothing-to-do` for a run an End
 * node ended with nothing to do. Finished, but quiet.
 */
export type StatusKey = RunStatus | "nothing-to-do";

/** A run's status as a screen shows it. */
export type RunStatusView = {
	/** The look to draw. */
	key: StatusKey;
	/** The word: "Running", "Waiting for you", "Nothing to do". */
	word: string;
	/** The group it counts in. */
	group: RunGroup;
	/** Nothing runs and nothing waits. */
	ended: boolean;
};

/** A run's status as every screen shows it, the result of its End node included. */
export function statusOf(run: {
	status: RunStatus;
	result?: RunResult | null;
}): RunStatusView {
	const nothing = run.status === "finished" && run.result === "nothing-to-do";
	return {
		key: nothing ? "nothing-to-do" : run.status,
		word: nothing ? "Nothing to do" : STATUS_LABELS[run.status],
		group: GROUP_OF[run.status],
		ended: hasEnded(run.status),
	};
}
