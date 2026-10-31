import { type DashboardSummary, formatKnownCost } from "@nightshift/client";

/** A run in a dashboard list: its title, status, start, branch and project. */
export type NightRun = DashboardSummary["open"]["rows"][number];

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** The numbers of "Last night". Null where the summary does not tell. */
export type NightNumbers = {
	finished: number | null;
	/** Failed and interrupted runs, as the Runs tab's Failed chip counts them. */
	failed: number | null;
	stopped: number | null;
	cost: string;
	/** "Of 12 runs". */
	costCaption: string;
};

/**
 * How the latest night with runs went: how many of its runs finished,
 * failed and stopped, and what they cost. The counts come from the night
 * ranges. A night older than every range is counted from its runs, when
 * the summary lists them all. Null without runs.
 */
export function nightNumbers(summary: DashboardSummary): NightNumbers | null {
	const night = summary.lastNight;
	if (!night) return null;
	const counts = summary.nights
		.flatMap((range) => range.runs.perNight)
		.find((entry) => entry.night === night.night)?.counts;
	const complete = night.latest.length >= night.runs;
	const count = (...statuses: string[]): number | null =>
		counts
			? statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0)
			: complete
				? night.latest.filter((run) => statuses.includes(run.status)).length
				: null;
	return {
		finished: count("finished"),
		failed: count("failed", "interrupted"),
		stopped: count("stopped"),
		cost: formatKnownCost(night.cost),
		costCaption: `Of ${plural(night.runs, "run", "runs")}`,
	};
}

/**
 * The muted line under the lead: "Last night: 4 finished, 1 failed, 1
 * stopped." When the summary does not tell the counts: "Last night: 12
 * runs."
 */
export function nightLine(numbers: NightNumbers, runs: number): string {
	const { finished, failed, stopped } = numbers;
	if (finished === null || failed === null || stopped === null) {
		return `Last night: ${plural(runs, "run", "runs")}.`;
	}
	return `Last night: ${finished} finished, ${failed} failed, ${stopped} stopped.`;
}

/** What waits for you, as the lead needs it: a Gate with its deadline, or something else. */
export type LeadItem =
	| { kind: "gate"; gate: { deadline: { at: number } | null } }
	| { kind: "run" | "learning" };

/**
 * The lead of Watch: does something need you. "2 Gates wait for you.
 * Answer the first by 07:30." "3 things wait for you. No Gate is open."
 * "Nothing needs you. Night Shift keeps watch." The Gates come first in
 * `items`, the first to close first.
 */
export function leadText(
	items: readonly LeadItem[],
	time: (epochMs: number) => string,
): string {
	if (items.length === 0) return "Nothing needs you. Night Shift keeps watch.";
	const gates = items.flatMap((item) =>
		item.kind === "gate" ? [item.gate] : [],
	);
	if (gates.length === 0) {
		return `${plural(items.length, "thing waits", "things wait")} for you. No Gate is open.`;
	}
	const wait = `${plural(gates.length, "Gate waits", "Gates wait")} for you.`;
	const at = gates[0]?.deadline?.at;
	if (!at) return wait;
	return gates.length === 1
		? `${wait} Answer it by ${time(at)}.`
		: `${wait} Answer the first by ${time(at)}.`;
}

/** "Saturday 31 October · 07:12": the line under the title of Watch. */
export function todayLine(
	now: number,
	time: (epochMs: number) => string,
): string {
	const day = new Date(now).toLocaleDateString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
	});
	return `${day} · ${time(now)}`;
}

/** The statuses of a run that has not ended. */
const LIVE = new Set(["running", "waiting", "sleeping"]);

/** The statuses of a run at work now: running, or waiting at a Gate. */
const AT_WORK = new Set(["running", "waiting"]);

/**
 * The runs at work now, running or waiting, the newest first. The summary
 * lists the oldest open runs and the newest runs of the last night: a run
 * in neither is behind "Runs".
 */
export function runningNow(summary: DashboardSummary): NightRun[] {
	const seen = new Set<string>();
	return [...summary.open.rows, ...(summary.lastNight?.latest ?? [])]
		.filter((run) => {
			if (!AT_WORK.has(run.status) || seen.has(run.id)) return false;
			seen.add(run.id);
			return true;
		})
		.sort((a, b) => b.createdAt - a.createdAt);
}

/** The runs of the last night that ended, newest first, at most `limit`. */
export function nightOutput(summary: DashboardSummary, limit = 4): NightRun[] {
	return (summary.lastNight?.latest ?? [])
		.filter((run) => !LIVE.has(run.status))
		.slice(0, limit);
}
