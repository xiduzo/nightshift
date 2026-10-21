import type { RunSummary } from "./types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function clock(at: Date): string {
	const hours = String(at.getHours()).padStart(2, "0");
	const minutes = String(at.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
}

function startOfDay(at: Date): number {
	return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
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

/** A run's cost when Night Shift knows it: "$0.42", "$1.20+" when a step did not report its cost. Null when nothing is known yet. */
export function costLabel(
	run: Pick<RunSummary, "costUsd" | "costMissing" | "costCalls">,
): string | null {
	if (run.costCalls === 0 && run.costUsd === 0) return null;
	if (run.costUsd === 0 && run.costMissing > 0) return null;
	const text = `$${run.costUsd.toFixed(2)}`;
	return run.costMissing > 0 ? `${text}+` : text;
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
