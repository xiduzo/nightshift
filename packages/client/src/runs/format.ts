import type { RunSummary } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function clock(at: Date): string {
	const hours = String(at.getHours()).padStart(2, "0");
	const minutes = String(at.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
}

function startOfDay(at: Date): number {
	return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/**
 * How long ago, short: "just now", "5 min ago", "3 h ago", "yesterday",
 * "4 days ago", or the date. Written out because Hermes has no
 * `Intl.RelativeTimeFormat` on every platform. A time in the future reads
 * as "just now".
 */
export function agoLabel(at: number, now = Date.now()): string {
	const ago = now - at;
	if (ago < MINUTE) return "just now";
	if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
	if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
	const days = Math.floor(ago / DAY);
	if (days === 1) return "yesterday";
	if (days < 7) return `${days} days ago`;
	return new Date(at).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
	});
}

/** When something started, short: "Just now", "12 min ago", "Today 09:41", "Yesterday 23:05", "3 Oct 14:20". */
export function whenLabel(at: number, now = Date.now()): string {
	const ago = now - at;
	if (ago >= 0 && ago < MINUTE) return "Just now";
	if (ago >= 0 && ago < 60 * MINUTE) {
		return `${Math.floor(ago / MINUTE)} min ago`;
	}
	const date = new Date(at);
	const days = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / DAY);
	if (days === 0) return `Today ${clock(date)}`;
	if (days === 1) return `Yesterday ${clock(date)}`;
	const day = date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
	});
	return `${day} ${clock(date)}`;
}

/** A cost and how sure it is, as runs, steps, subflow runs and the dashboard carry it. */
export type KnownCost = {
	costUsd: number;
	/** Part of it is estimated from tokens. */
	costEstimated?: boolean;
	/** Parts that ended without a cost: not in `costUsd`. */
	costMissing?: number;
};

/** "$2.93", "$0.0412" below a dollar, "—" when there is no cost. */
export function formatCost(usd: number | null | undefined): string {
	if (usd == null) return "—";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: usd > 0 && usd < 1 ? 4 : 2,
	}).format(usd);
}

/** "$2.93"; "$2.93+" when part of the cost is not known; "—" when none of it is. */
export function formatKnownCost(cost: KnownCost): string {
	const missing = cost.costMissing ?? 0;
	if (missing === 0) return formatCost(cost.costUsd);
	return cost.costUsd > 0 ? `${formatCost(cost.costUsd)}+` : "—";
}

/** A run's cost when Night Shift knows it, as `formatKnownCost` writes it: "$0.4231", "$1.20+" when a step did not report its cost. Null when nothing is known yet. */
export function costLabel(
	run: Pick<RunSummary, "costUsd" | "costMissing" | "costCalls">,
): string | null {
	if (run.costCalls === 0 && run.costUsd === 0) return null;
	if (run.costUsd === 0 && run.costMissing > 0) return null;
	return formatKnownCost(run);
}

/** The flow of a run: its name, or "Quick run" for a flow that is not a file. */
export function flowLabel(run: Pick<RunSummary, "flowName">): string {
	return run.flowName ?? "Quick run";
}

const STATUS_LABELS: Record<RunSummary["status"], string> = {
	running: "Running",
	waiting: "Waiting for you",
	sleeping: "Sleeping",
	finished: "Finished",
	stopped: "Stopped",
	failed: "Failed",
	interrupted: "Interrupted",
};

/** A run's status in words, as every screen shows it: "Running", "Waiting for you". */
export function runStatusLabel(status: RunSummary["status"]): string {
	return STATUS_LABELS[status];
}
