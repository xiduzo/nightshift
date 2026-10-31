import { waitedText } from "./inbox";
import type { OpenGate } from "./types";

/** A Gate's deadline: when it falls, and the choice Night Shift picks then. */
type GateDeadline = NonNullable<OpenGate["deadline"]>;

const DAY = 86_400_000;

/** A deadline this close shows in the Gate's row. */
const SOON_MS = 60 * 60_000;

/** The start of the day of a moment, on this device's clock. */
function dayOf(epochMs: number): number {
	const date = new Date(epochMs);
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	).getTime();
}

/**
 * When a Gate's deadline falls, in words: its time ("07:00") and the day
 * that goes after it (" tomorrow", " on Friday"). Today, or a deadline
 * that has passed, adds no day.
 */
export function deadlineWhen(
	at: number,
	now: number,
): { time: string; day: string } {
	const days = Math.round((dayOf(at) - dayOf(now)) / DAY);
	const day =
		days <= 0
			? ""
			: days === 1
				? " tomorrow"
				: ` on ${new Date(at).toLocaleDateString(undefined, { weekday: "long" })}`;
	const time = new Date(at).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
	return { time, day };
}

/**
 * What happens to a Gate when nobody answers in time: "If nobody answers,
 * Night Shift picks keep at 07:00 tomorrow."
 */
export function deadlineText(deadline: GateDeadline, now: number): string {
	const { time, day } = deadlineWhen(deadline.at, now);
	return `If nobody answers, Night Shift picks ${deadline.choose} at ${time}${day}.`;
}

/**
 * A deadline in the next hour, short, for a Gate's row: "Picks keep in
 * 12 min". Null when the Gate has no deadline, the deadline is further
 * away, or it has passed.
 */
export function deadlineSoon(
	deadline: GateDeadline | null,
	now: number,
): string | null {
	if (!deadline) return null;
	const left = deadline.at - now;
	if (left <= 0 || left > SOON_MS) return null;
	return `Picks ${deadline.choose} in ${waitedText(left)}`;
}
