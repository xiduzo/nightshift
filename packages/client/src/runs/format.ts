import type { BuiltInOutcome } from "@nightshift/flows";

import type { RunResult, RunSummary, StepOutcome } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

/** A countdown: "4:05", "1:02:09". Zero when the moment has passed. */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `${minutes}:${seconds}`;
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

const OUTCOME_LABELS: Record<BuiltInOutcome, string> = {
	pass: "Pass",
	fail: "Fail",
	"needs-input": "Needs input",
	done: "Done",
	halted: "Halted",
	timeout: "Timed out",
	error: "Error",
	stopped: "Stopped",
	interrupted: "Interrupted",
};

/**
 * The outcome a step ended on, in words, as every screen shows it: "Pass",
 * "Needs input", "Error". An outcome the flow names itself (an agent
 * outcome, a command exit, a Gate choice) shows its own name: "approve".
 */
export function stepOutcomeLabel(outcome: StepOutcome): string {
	return Object.hasOwn(OUTCOME_LABELS, outcome)
		? OUTCOME_LABELS[outcome as BuiltInOutcome]
		: outcome;
}

const RESULT_LABELS: Record<RunResult, string> = {
	done: "Done",
	"nothing-to-do": "Nothing to do",
	failed: "Failed",
};

/**
 * How a run that an End node ended came out, in words, with the End's
 * message: "Nothing to do: No open issues". Null for a run no End node
 * ended.
 */
export function runEndLine(
	run: Pick<RunSummary, "result" | "reason">,
): string | null {
	// An older Host sends no result at all.
	if (!run.result) return null;
	const label = RESULT_LABELS[run.result];
	return run.reason ? `${label}: ${run.reason}` : label;
}

/**
 * A count, short: "950", "12.3K", "123K", "1.2M". Written out because
 * Hermes does not format compact numbers on every platform.
 */
export function compactCount(count: number): string {
	const round = (value: number) =>
		value < 100
			? String(Math.round(value * 10) / 10)
			: String(Math.round(value));
	if (count < 1000) return String(Math.round(count));
	if (count < 999_500) return `${round(count / 1000)}K`;
	return `${round(count / 1_000_000)}M`;
}

/** The tokens a run's or a step's agents used, as its metrics carry them. */
type Tokens = { input: number; output: number };

/** "12.3K tokens": the tokens in and out. Null when none are known. */
export function tokensLabel(tokens: Tokens | null | undefined): string | null {
	const used = tokens ? tokens.input + tokens.output : 0;
	return used > 0 ? `${compactCount(used)} tokens` : null;
}

/** "12K in, 300 out": what the tokens of `tokensLabel` are made of. Null when none are known. */
export function tokensSplit(tokens: Tokens | null | undefined): string | null {
	if (!tokens || tokens.input + tokens.output === 0) return null;
	return `${compactCount(tokens.input)} in, ${compactCount(tokens.output)} out`;
}
