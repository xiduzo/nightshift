import {
	dayStart,
	formatWeekdayDate,
	formatWeekdayDateYear,
	localZone,
	now,
	wall,
} from "../time";

/**
 * The name of a day on the reader's clock: "Today", "Yesterday", or its
 * weekday and date ("Wed 15 Oct"), with the year when it is not this
 * year. `day` is any moment of that day, such as the start the dashboard
 * gives (`lastNight.night`) or when a run started.
 */
export function dayLabel(
	day: number,
	at: number = now(),
	timeZone: string = localZone(),
): string {
	const today = dayStart(at, timeZone);
	const start = dayStart(day, timeZone);
	if (start === today) return "Today";
	if (start === dayStart(today - 1, timeZone)) return "Yesterday";
	return wall(day, timeZone).year === wall(at, timeZone).year
		? formatWeekdayDate(day, timeZone)
		: formatWeekdayDateYear(day, timeZone);
}
