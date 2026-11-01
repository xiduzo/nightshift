import {
	compactCount,
	formatDateTime as dateTimeOf,
	formatDayTime as dayTimeOf,
	formatCost,
	formatKnownCost,
	type KnownCost,
	now,
	formatRelative as relativeOf,
	formatTime as timeOf,
	tokensLabel,
	type UsageTokens,
	usageLabel,
} from "@nightshift/client";
import { nextTimeOfDay } from "@nightshift/flows";

// One way to write a cost on every screen: the phone uses the same two.
export { formatCost, formatKnownCost, type KnownCost };

/** "3 minutes ago", "yesterday", "just now". */
export function formatRelative(epochMs: number, at = now()): string {
	return relativeOf(epochMs, at);
}

export function formatDateTime(epochMs: number): string {
	return dateTimeOf(epochMs);
}

export function formatTime(epochMs: number): string {
	return timeOf(epochMs);
}

/** A step that runs and has not reported any spend yet: its cost is not known. */
export function noCostYet(step: {
	endedAt: number | null;
	costCalls: number;
}): boolean {
	return step.endedAt === null && step.costCalls === 0;
}

/** A step's cost: "—" while it runs and has not reported any spend yet. */
export function formatStepCost(
	step: KnownCost & { endedAt: number | null; costCalls: number },
): string {
	return noCostYet(step) ? "—" : formatKnownCost(step);
}

/**
 * A step's tokens and cost together: "12.3K tokens · $0.0412". "—" while
 * it runs and has reported neither yet.
 */
export function formatStepUsage(
	step: KnownCost & {
		endedAt: number | null;
		costCalls: number;
		metrics?: { tokens: UsageTokens } | null;
	},
): string {
	const tokens = step.metrics?.tokens;
	if (noCostYet(step)) return usageLabel(tokens, null) ?? "—";
	return usageLabel(tokens, formatKnownCost(step)) ?? "—";
}

/** A dollar amount with its tokens, when any were used. */
export function costWithTokens(
	cost: string,
	tokens: UsageTokens | number | null | undefined,
): string {
	return usageLabel(tokens, cost) ?? cost;
}

/** "A finished run typically costs $0.42 and uses 12K tokens." */
export function typicalCostSentence(
	medianUsd: number,
	tokenUse: { median: number } | null,
): string {
	const money = formatCost(medianUsd);
	const used = tokenUse
		? tokensLabel({ input: tokenUse.median, output: 0 })
		: null;
	return used
		? `A finished run typically costs ${money} and uses ${used}.`
		: `A finished run typically costs ${money}.`;
}

/** "Half of them cost $0.10 to $0.40. Half use 8K to 20K tokens." */
export function costHalfSentence(
	cost: { q1: number; q3: number },
	tokenUse: { q1: number; q3: number } | null,
): string {
	const money = `Half of them cost ${formatCost(cost.q1)} to ${formatCost(cost.q3)}.`;
	if (!tokenUse) return money;
	return `${money} Half use ${compactCount(tokenUse.q1)} to ${compactCount(tokenUse.q3)} tokens.`;
}

/** "The cheapest cost $0.10, the most $0.40. They used 1K to 80K tokens." */
export function costEndsSentence(
	cost: { min: number; max: number },
	tokenUse: { min: number; max: number } | null,
): string {
	const money = `The cheapest cost ${formatCost(cost.min)}, the most ${formatCost(cost.max)}.`;
	if (!tokenUse) return money;
	return `${money} They used ${compactCount(tokenUse.min)} to ${compactCount(tokenUse.max)} tokens.`;
}

/** The costs of several runs or steps together. */
export function sumKnownCost(costs: readonly KnownCost[]): KnownCost {
	return {
		costUsd: costs.reduce((sum, cost) => sum + cost.costUsd, 0),
		costEstimated: costs.some((cost) => cost.costEstimated),
		costMissing: costs.reduce((sum, cost) => sum + (cost.costMissing ?? 0), 0),
	};
}

/** What a person should know about a cost, for its tooltip; undefined when nothing. */
export function costNote(cost: KnownCost): string | undefined {
	const missing = cost.costMissing ?? 0;
	const notes = [
		...(missing > 0
			? [
					missing === 1
						? "1 step did not report its cost."
						: `${missing} steps did not report their cost.`,
				]
			: []),
		...(cost.costEstimated
			? ["Night Shift estimates part of it from tokens."]
			: []),
	];
	return notes.length > 0 ? notes.join(" ") : undefined;
}

export function formatTokens(count: number): string {
	return new Intl.NumberFormat("en-US", { notation: "compact" }).format(count);
}

export function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "42s", "3m 05s", "1h 02m". */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	}
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** "Thu 16 Oct, 07:00": a moment within the next days, with its weekday. */
export function formatDayTime(epochMs: number): string {
	return dayTimeOf(epochMs);
}

/**
 * The next time the clock shows `hhmm` ("07:00"): later today, else tomorrow.
 * Null when the text is not a time.
 */
export function nextOccurrence(hhmm: string, at = now()): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;
	const text = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
	return nextTimeOfDay(text, at);
}

/** A file size in bytes, as a person reads it: `512 B`, `12 KB`, `3.4 MB`. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
