import {
	formatCost,
	formatKnownCost,
	type KnownCost,
} from "@nightshift/client";

// One way to write a cost on every screen: the phone uses the same two.
export { formatCost, formatKnownCost, type KnownCost };

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 60 * 60 * 1000],
	["month", 30 * 24 * 60 * 60 * 1000],
	["day", 24 * 60 * 60 * 1000],
	["hour", 60 * 60 * 1000],
	["minute", 60 * 1000],
];

/** "3 minutes ago", "yesterday", "just now". */
export function formatRelative(epochMs: number, now = Date.now()): string {
	const diff = epochMs - now;
	for (const [unit, ms] of UNITS) {
		if (Math.abs(diff) >= ms) {
			return relativeTime.format(Math.round(diff / ms), unit);
		}
	}
	return "just now";
}

export function formatDateTime(epochMs: number): string {
	return new Date(epochMs).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function formatTime(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString(undefined, {
		timeStyle: "short",
	});
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
	return new Date(epochMs).toLocaleString(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** "today", "tomorrow", or the weekday, for a moment after `now`. */
export function dayWord(epochMs: number, now = Date.now()): string {
	const day = (ms: number) => {
		const date = new Date(ms);
		return new Date(
			date.getFullYear(),
			date.getMonth(),
			date.getDate(),
		).getTime();
	};
	const days = Math.round((day(epochMs) - day(now)) / (24 * 60 * 60 * 1000));
	if (days === 0) return "today";
	if (days === 1) return "tomorrow";
	return new Date(epochMs).toLocaleDateString(undefined, { weekday: "long" });
}

/**
 * The next time the clock shows `hhmm` ("07:00"): later today, else tomorrow.
 * Null when the text is not a time.
 */
export function nextOccurrence(hhmm: string, now = Date.now()): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;
	const date = new Date(now);
	date.setHours(hours, minutes, 0, 0);
	if (date.getTime() <= now) date.setDate(date.getDate() + 1);
	return date.getTime();
}

/** A file size in bytes, as a person reads it: `512 B`, `12 KB`, `3.4 MB`. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
