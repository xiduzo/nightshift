import { localZone } from "@nightshift/client";

/** What Settings offers to choose, without React Native: the hours and the phone's time zone. */

/** Every hour of the day, `00:00` to `23:00`. */
export const HOURS = Array.from(
	{ length: 24 },
	(_, hour) => `${String(hour).padStart(2, "0")}:00`,
);

/** One choice of a Select in Settings: a time or a delay. */
export type Choice = { value: string; label: string };

/** The phone's time zone, for quiet hours. */
export function phoneTimeZone(): string {
	return localZone();
}
