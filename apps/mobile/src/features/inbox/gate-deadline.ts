import type { OpenGate } from "@nightshift/client";
import { formatTime } from "@/shared/format";

/** The start of the day of a moment, on this phone's clock. */
function dayOf(epochMs: number): number {
	const date = new Date(epochMs);
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	).getTime();
}

/**
 * What happens to a Gate when nobody answers in time, as the web says it:
 * "If nobody answers, Night Shift picks keep at 07:00 tomorrow."
 */
export function deadlineText(
	deadline: NonNullable<OpenGate["deadline"]>,
	now: number,
): string {
	const days = Math.round((dayOf(deadline.at) - dayOf(now)) / 86_400_000);
	const day =
		days <= 0
			? ""
			: days === 1
				? " tomorrow"
				: ` on ${new Date(deadline.at).toLocaleDateString(undefined, { weekday: "long" })}`;
	return `If nobody answers, Night Shift picks ${deadline.choose} at ${formatTime(deadline.at)}${day}.`;
}
