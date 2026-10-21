import type { DashboardSummary, RunSummary } from "@nightshift/client";

import { formatAgo, formatKnownCost, formatTime } from "@/shared/format";

/** The status color a card takes, when a run needs the eye. */
export type CardTone = "plain" | "waiting" | "failed";

/** One stat card, ready to show. */
export type StatCardView = {
	key: "running" | "waiting" | "spent" | "runs";
	label: string;
	value: string;
	headline: string;
	footer: string;
	tone: CardTone;
	/** The tab it opens, if any. */
	opens: "inbox" | "runs" | null;
	/** A bar under the number: the share of runs that finished. */
	finishedShare: number | null;
};

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/**
 * The four numbers on top, as the web dashboard shows them: running now,
 * waiting for you, spent and runs in the last 24 hours. `waiting` is the
 * number of open Gates, null when they did not load.
 */
export function statCards(
	summary: DashboardSummary,
	waiting: number | null,
): StatCardView[] {
	const { running, sleeping, nextWakeAt, lastDay, allTime } = summary.cards;
	const other = lastDay.runs - lastDay.finished - lastDay.failed;
	return [
		{
			key: "running",
			label: "Running now",
			value: String(running),
			headline:
				running > 0
					? running === 1
						? "An agent is at work"
						: "Agents are at work"
					: "Nothing running",
			footer:
				nextWakeAt && sleeping > 0
					? `${plural(sleeping, "run sleeps", "runs sleep")}. The next wakes at ${formatTime(nextWakeAt)}.`
					: "Start a flow in the Start tab.",
			tone: "plain",
			opens: "runs",
			finishedShare: null,
		},
		{
			key: "waiting",
			label: "Waiting for you",
			value: waiting === null ? "—" : String(waiting),
			headline:
				waiting && waiting > 0
					? waiting === 1
						? "A Gate needs your answer"
						: "Gates need your answer"
					: "Nothing needs you",
			footer: "Runs pause at a Gate for you.",
			tone: waiting && waiting > 0 ? "waiting" : "plain",
			opens: "inbox",
			finishedShare: null,
		},
		{
			key: "spent",
			label: "Spent, last 24 h",
			value: formatKnownCost(lastDay.cost),
			headline: `In ${plural(lastDay.runs, "run", "runs")}`,
			footer: `All time ${formatKnownCost(allTime)}`,
			tone: "plain",
			opens: null,
			finishedShare: null,
		},
		{
			key: "runs",
			label: "Runs, last 24 h",
			value: String(lastDay.runs),
			headline: `${lastDay.finished} finished, ${lastDay.failed} failed`,
			footer:
				other > 0
					? `${other} stopped, running or waiting`
					: "Started in the last day",
			tone: lastDay.failed > 0 ? "failed" : "plain",
			opens: "runs",
			finishedShare:
				lastDay.runs > 0
					? Math.round((lastDay.finished / lastDay.runs) * 100)
					: null,
		},
	];
}

/**
 * The facts under a run's title: its flow (unless the title says it),
 * when it started, and its cost. "nightly-check, 5 min ago, $0.42".
 */
export function runFacts(run: RunSummary, now: number): string {
	const flow = run.flowName ?? "Quick run";
	return [
		...(flow === run.title ? [] : [flow]),
		formatAgo(run.createdAt, now),
		formatKnownCost(run),
	].join(", ");
}

/** Whether any run is known: without one, the dashboard has nothing to show. */
export function hasRuns(summary: DashboardSummary): boolean {
	return summary.recent.length > 0;
}
