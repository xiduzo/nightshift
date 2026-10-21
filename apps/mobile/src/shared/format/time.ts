const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or the
 * date. Short, for a phone row. Written out because Hermes has no
 * `Intl.RelativeTimeFormat` on every platform.
 */
export function formatAgo(epochMs: number, now = Date.now()): string {
	const ago = now - epochMs;
	if (ago < MINUTE) return "just now";
	if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
	if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
	const days = Math.floor(ago / DAY);
	if (days === 1) return "yesterday";
	if (days < 7) return `${days} days ago`;
	return new Date(epochMs).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
	});
}

/** "14:05" or "2:05 PM": a time of day on this phone's clock. */
export function formatTime(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}
