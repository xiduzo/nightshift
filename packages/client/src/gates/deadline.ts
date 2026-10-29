import type { OpenGate } from "./types";

/** A Gate's deadline: when it falls, and the choice Night Shift picks then. */
type GateDeadline = NonNullable<OpenGate["deadline"]>;

const DAY = 86_400_000;

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
