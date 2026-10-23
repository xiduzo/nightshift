import {
	type DashboardSummary,
	formatKnownCost,
	type OpenGate,
	waitedText,
} from "@nightshift/client";

import { formatTime } from "@/shared/format";

/** A run in a dashboard list: its title, status, start, branch and project. */
export type NightRun = DashboardSummary["open"]["rows"][number];

type LastNight = NonNullable<DashboardSummary["lastNight"]>;

/** How the summary writes a day and a time of day. The phone's clock by default. */
export type Clock = {
	day: (epochMs: number) => string;
	time: (epochMs: number) => string;
};

/** "Wed 22 Oct": the evening a night starts. */
function formatDay(epochMs: number): string {
	return new Date(epochMs).toLocaleDateString(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}

const PHONE_CLOCK: Clock = { day: formatDay, time: formatTime };

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/**
 * The line under "Last night": the night and when its runs started.
 * "Wed 22 Oct · 4 runs, 18:02–03:15". When the night has more runs than
 * the summary lists, the first start is not known: "Wed 22 Oct · 12 runs,
 * the newest at 03:15".
 */
export function nightLine(night: LastNight, clock = PHONE_CLOCK): string {
	const day = clock.day(night.night);
	const starts = night.latest.map((run) => run.createdAt);
	if (starts.length === 0)
		return `${day} · ${plural(night.runs, "run", "runs")}`;
	const newest = Math.max(...starts);
	if (night.runs > starts.length) {
		return `${day} · ${night.runs} runs, the newest at ${clock.time(newest)}`;
	}
	if (night.runs === 1) return `${day} · 1 run at ${clock.time(newest)}`;
	const oldest = Math.min(...starts);
	return `${day} · ${night.runs} runs, ${clock.time(oldest)}–${clock.time(newest)}`;
}

/** The numbers of the "Last night" card. Null where the summary does not tell. */
export type NightNumbers = {
	finished: number | null;
	failed: number | null;
	cost: string;
	/** "In 12 runs". */
	costCaption: string;
	/** "3 h 20 min of run time in the last 24 h". Null without run time. */
	runTime: string | null;
};

/**
 * How the latest night with runs went: how many of its runs finished and
 * failed, and what they cost. The counts come from the night ranges; a
 * night older than every range is counted from its runs, when the summary
 * lists them all. The run time is the time runs were at work over the last
 * 24 hours, Gates included: the Host counts no time per night. Null
 * without runs.
 */
export function nightNumbers(summary: DashboardSummary): NightNumbers | null {
	const night = summary.lastNight;
	if (!night) return null;
	const counts = summary.nights
		.flatMap((range) => range.runs.perNight)
		.find((entry) => entry.night === night.night)?.counts;
	const complete = night.latest.length >= night.runs;
	const count = (status: string): number | null =>
		counts
			? (counts[status] ?? 0)
			: complete
				? night.latest.filter((run) => run.status === status).length
				: null;
	return {
		finished: count("finished"),
		failed: count("failed"),
		cost: formatKnownCost(night.cost),
		costCaption: `In ${plural(night.runs, "run", "runs")}`,
		runTime: runTimeText(summary),
	};
}

function runTimeText(summary: DashboardSummary): string | null {
	const day = summary.activity.find((range) => range.hours === 24);
	if (!day) return null;
	const total = day.groups.rows.reduce((sum, group) => sum + group.atWork, 0);
	if (total <= 0) return null;
	// The summary lists the busiest groups only: the rest adds more.
	const partial = day.groups.count > day.groups.rows.length;
	return `${partial ? "Over " : ""}${waitedText(total)} of run time in the last 24 h`;
}

/** The statuses of a run that has not ended. */
const LIVE = new Set(["running", "waiting", "sleeping"]);

/**
 * How many runs of the last night ended, also the ones the summary does
 * not list. Null when the summary does not tell.
 */
export function endedCount(summary: DashboardSummary): number | null {
	const night = summary.lastNight;
	if (!night) return 0;
	const counts = summary.nights
		.flatMap((range) => range.runs.perNight)
		.find((entry) => entry.night === night.night)?.counts;
	if (counts) {
		return Object.entries(counts)
			.filter(([status]) => !LIVE.has(status))
			.reduce((sum, [, count]) => sum + (count ?? 0), 0);
	}
	if (night.latest.length >= night.runs) {
		return night.latest.filter((run) => !LIVE.has(run.status)).length;
	}
	return null;
}

/** The Gates on Home: the ones you may answer, oldest first, at most `limit`. */
export function needsYou<G extends Pick<OpenGate, "canAnswer">>(
	gates: readonly G[],
	limit = 5,
): G[] {
	return gates.filter((gate) => gate.canAnswer).slice(0, limit);
}

/**
 * The runs at work now, the longest at work first. The summary lists the
 * oldest open runs and the newest runs of the last night: a running run
 * in neither is behind "See all".
 */
export function runningNow(summary: DashboardSummary): NightRun[] {
	const seen = new Set<string>();
	return [...summary.open.rows, ...(summary.lastNight?.latest ?? [])]
		.filter((run) => {
			if (run.status !== "running" || seen.has(run.id)) return false;
			seen.add(run.id);
			return true;
		})
		.sort((a, b) => a.createdAt - b.createdAt);
}

/** The runs of the last night that ended, newest first: what there is to check. */
export function nightOutput(summary: DashboardSummary): NightRun[] {
	return (summary.lastNight?.latest ?? []).filter(
		(run) => !LIVE.has(run.status),
	);
}

/** The hint of a section: "Oldest first · 3 open", or what it says when it is empty. */
export function needsYouHint(waiting: number): string {
	return waiting === 0
		? "Every Gate has an answer"
		: `Oldest first · ${waiting} open`;
}

export function runningHint(running: number): string {
	return running === 0
		? "Nothing runs right now"
		: `${plural(running, "run", "runs")} at work`;
}
