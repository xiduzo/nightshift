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

export function formatCost(usd: number | null | undefined): string {
	if (usd == null) return "—";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: usd > 0 && usd < 1 ? 4 : 2,
	}).format(usd);
}

/** A cost and how sure it is, as runs, steps and subflow runs carry it. */
export type KnownCost = {
	costUsd: number;
	/** Part of it is estimated from tokens. */
	costEstimated?: boolean;
	/** Parts that ended without a cost: not in `costUsd`. */
	costMissing?: number;
};

/** "$2.93"; "$2.93+" when part of the cost is not known; "—" when none of it is. */
export function formatKnownCost(cost: KnownCost): string {
	const missing = cost.costMissing ?? 0;
	if (missing === 0) return formatCost(cost.costUsd);
	return cost.costUsd > 0 ? `${formatCost(cost.costUsd)}+` : "—";
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
		...(cost.costEstimated ? ["Part of it is estimated from tokens."] : []),
	];
	return notes.length > 0 ? notes.join(" ") : undefined;
}

export function formatTokens(count: number): string {
	return new Intl.NumberFormat("en-US", { notation: "compact" }).format(count);
}

export function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "42s", "3m 05s", "1h 02m". With `exact`, an hour or more keeps its seconds: "1h 02m 07s". */
export function formatDuration(ms: number, exact = false): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
	return exact ? `${rest} ${String(seconds % 60).padStart(2, "0")}s` : rest;
}

/** How long something has waited: "under a minute", "12 min", "3 h 5 min", "2 days". */
export function formatWaited(ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / 60_000);
	if (minutes < 1) return "under a minute";
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
	}
	const days = Math.floor(hours / 24);
	return days === 1 ? "1 day" : `${days} days`;
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
