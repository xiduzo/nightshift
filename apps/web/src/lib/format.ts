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
