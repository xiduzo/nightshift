import {
	localZone,
	type NotificationSettings,
	type NotificationSettingsPatch,
} from "@nightshift/client";

/** What Settings offers to choose, without React Native: the hours, the digest times and the phone's time zone. */

/** Every hour of the day, `00:00` to `23:00`. */
export const HOURS = Array.from(
	{ length: 24 },
	(_, hour) => `${String(hour).padStart(2, "0")}:00`,
);

/** The morning: `06:00` to `09:00`, every half hour. */
export const DIGEST_TIMES = Array.from({ length: 7 }, (_, step) => {
	const minutes = 6 * 60 + step * 30;
	const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
	return `${hour}:${minutes % 60 === 0 ? "00" : "30"}`;
});

/** One choice of a Select in Settings: a time, a delay, "When quiet hours end" or "Off". */
export type Choice = { value: string; label: string };

const QUIET_END = "quiet-hours-end";
const OFF = "off";

type DigestSettings = Pick<NotificationSettings, "digest" | "quietHours">;

/**
 * The choice "It comes at" shows now. A digest that follows quiet hours
 * comes at its own time when there are none, so that time shows.
 */
export function digestValue(settings: DigestSettings): string {
	const { when, time } = settings.digest;
	if (when === OFF) return OFF;
	if (when === QUIET_END && settings.quietHours) return QUIET_END;
	return time;
}

/**
 * The choices of "It comes at": "When quiet hours end" when you have
 * quiet hours, the morning times, and Off. A time chosen elsewhere (on
 * the web) stays in the list, in its place.
 */
export function digestOptions(settings: DigestSettings): Choice[] {
	const now = digestValue(settings);
	const times =
		now !== OFF && now !== QUIET_END && !DIGEST_TIMES.includes(now)
			? [...DIGEST_TIMES, now].sort()
			: DIGEST_TIMES;
	return [
		...(settings.quietHours
			? [{ value: QUIET_END, label: "When quiet hours end" }]
			: []),
		...times.map((time) => ({ value: time, label: time })),
		{ value: OFF, label: "Off" },
	];
}

/** The change one choice of "It comes at" makes. */
export function digestPatch(value: string): NotificationSettingsPatch {
	if (value === OFF) return { digest: { when: "off" } };
	if (value === QUIET_END) return { digest: { when: "quiet-hours-end" } };
	return { digest: { when: "time", time: value } };
}

/** The phone's time zone, for quiet hours and the digest. */
export function phoneTimeZone(): string {
	return localZone();
}
