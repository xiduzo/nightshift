import {
	type DashboardSummary,
	formatKnownCost,
	formatLongDay,
	groupCounts,
	hasEnded,
	isTestRun,
	statusOf,
	tokensLabel,
} from "@nightshift/client";

/** A run in a dashboard list: its title, status, start, branch and project. */
export type WatchRun = DashboardSummary["open"]["rows"][number];

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/**
 * "12.3K tokens of 9 runs", or "Of 9 runs" when the day used none. The
 * spend counts the test runs, so the caption names them: "Of 8 runs and
 * 1 test run".
 */
function dayCaption(tokens: number, runs: number, tests: number): string {
	const used = tokensLabel(tokens);
	const count = [
		...(runs > 0 || tests === 0 ? [plural(runs, "run", "runs")] : []),
		...(tests > 0 ? [plural(tests, "test run", "test runs")] : []),
	].join(" and ");
	return used ? `${used} of ${count}` : `Of ${count}`;
}

/** The runs of the latest day without its test runs: what every count but the spend counts. */
export function dayRuns(day: { runs: number; tests?: number }): number {
	return Math.max(day.runs - (day.tests ?? 0), 0);
}

/**
 * The numbers of the latest day with runs. Null where the summary does
 * not tell. Each count is a group of `statusOf`, as the Runs chip that its
 * tile opens counts it.
 */
export type DayNumbers = {
	finished: number | null;
	failed: number | null;
	/** Stopped and interrupted runs. */
	stopped: number | null;
	cost: string;
	/** "Of 12 runs", or "Of 11 runs and 1 test run". */
	costCaption: string;
};

/** How many runs of the latest day have each status, test runs left out. Null when the summary does not tell. */
function dayStatuses(
	summary: DashboardSummary,
): Readonly<Partial<Record<string, number>>> | null {
	const day = summary.lastNight;
	if (!day) return null;
	const counts = summary.nights
		.flatMap((range) => range.runs.perNight)
		.find((entry) => entry.night === day.night)?.counts;
	if (counts) return counts;
	if (day.latest.length < day.runs) return null;
	const statuses: Partial<Record<string, number>> = {};
	for (const run of day.latest) {
		if (!isTestRun(run)) statuses[run.status] = (statuses[run.status] ?? 0) + 1;
	}
	return statuses;
}

/**
 * How the latest day with runs went: how many of its runs finished,
 * failed and stopped, and what they cost. The counts come from the ranges
 * of days. A day older than every range is counted from its runs, when
 * the summary lists them all. A test run counts only in the cost. Null
 * without runs.
 */
export function dayNumbers(summary: DashboardSummary): DayNumbers | null {
	const day = summary.lastNight;
	if (!day) return null;
	const statuses = dayStatuses(summary);
	const groups = statuses ? groupCounts(statuses) : null;
	return {
		finished: groups?.finished ?? null,
		failed: groups?.failed ?? null,
		stopped: groups?.stopped ?? null,
		cost: formatKnownCost(day.cost),
		costCaption: dayCaption(day.tokens, dayRuns(day), day.tests ?? 0),
	};
}

/**
 * The muted line under the lead, with the name of the day ("Today",
 * "Yesterday", "Wed 15 Oct"): "Today: 4 finished, 1 failed, 1 stopped."
 * When the summary does not tell the counts: "Today: 12 runs."
 */
export function dayLine(
	numbers: DayNumbers,
	runs: number,
	day: string,
): string {
	const { finished, failed, stopped } = numbers;
	if (finished === null || failed === null || stopped === null) {
		return `${day}: ${plural(runs, "run", "runs")}.`;
	}
	return `${day}: ${finished} finished, ${failed} failed, ${stopped} stopped.`;
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
	return `${formatLongDay(now)} · ${time(now)}`;
}

/** Tokens a run reported, from a dashboard row or from a whole run. */
function runTokens(run: {
	tokens?: { input: number; output: number } | null;
	metrics?: { tokens: { input: number; output: number } } | null;
}): { input: number; output: number } | null {
	if (run.tokens && run.tokens.input + run.tokens.output > 0) return run.tokens;
	const tokens = run.metrics?.tokens;
	if (!tokens || tokens.input + tokens.output <= 0) return null;
	return { input: tokens.input, output: tokens.output };
}

/**
 * The runs on their way now, running or asleep, the newest first: the
 * Running chip of Runs. A run at a Gate waits in Needs you. The summary
 * lists the oldest open runs and the newest runs of the latest day: a run
 * in neither is behind "Runs".
 */
export function runningNow(summary: DashboardSummary): WatchRun[] {
	const seen = new Set<string>();
	return [...summary.open.rows, ...(summary.lastNight?.latest ?? [])]
		.filter((run) => {
			if (statusOf(run).group !== "running" || seen.has(run.id)) return false;
			seen.add(run.id);
			return true;
		})
		.sort((a, b) => b.createdAt - a.createdAt)
		.map((run) => ({ ...run, tokens: runTokens(run) }));
}

/** The runs of the latest day that ended, newest first, at most `limit`. */
export function dayOutput(summary: DashboardSummary, limit = 4): WatchRun[] {
	return (summary.lastNight?.latest ?? [])
		.filter((run) => hasEnded(run.status))
		.slice(0, limit)
		.map((run) => ({ ...run, tokens: runTokens(run) }));
}
