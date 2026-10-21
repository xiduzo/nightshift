/** Every hour of the day, `00:00` to `23:00`. */
export const HOURS = Array.from(
	{ length: 24 },
	(_, hour) => `${String(hour).padStart(2, "0")}:00`,
);

/** The phone delays to choose from, in minutes. The Host takes 0 to 60. */
export const DELAY_OPTIONS = [0, 1, 3, 5, 10, 15, 30, 60];

export function delayLabel(minutes: number): string {
	if (minutes === 0) return "No delay";
	if (minutes === 60) return "1 hour";
	return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** The phone's time zone, for quiet hours. */
export function phoneTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}
