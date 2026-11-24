import {
	GATE_URGENCIES,
	type GateUrgency,
	gateUrgencySchema,
} from "@nightshift/flows";
import { isTimeZone, minuteOfDay } from "@nightshift/time";
import { z } from "zod";

/**
 * A Person's notification settings: which events, quiet hours, which
 * screens, and how long a phone waits while another screen is open. They
 * belong to the Person, not to a computer. A Person without a row has the
 * defaults.
 */

/** `HH:MM`, 24 hours. */
const timeOfDaySchema = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Use a time like 22:00." });

const timeZoneSchema = z.string().trim().min(1).max(64).refine(isTimeZone, {
	message: "Use a time zone like Europe/Amsterdam.",
});

const eventsSchema = z.object({
	/** A Gate waits for you. */
	gateOpened: z.boolean(),
	/** A run finished. */
	runFinished: z.boolean(),
	/** A run failed. */
	runFailed: z.boolean(),
	/** A step of a run for you waits for a device that is offline. */
	deviceWait: z.boolean(),
});

const quietHoursSchema = z.object({
	start: timeOfDaySchema,
	end: timeOfDaySchema,
});

/** Which kinds of screen get pushes. The open pages always update. */
const screensSchema = z.object({
	/** Browsers with every Night Shift page closed (Web Push). */
	web: z.boolean(),
	/** Phones with the Night Shift app (Expo Push). */
	expo: z.boolean(),
	/** The desktop app's own notifications. */
	desktop: z.boolean(),
});

/**
 * The Gate urgencies that push. A Gate of another urgency shows in the
 * inbox and counts on the badge, without a push. Empty: no Gate pushes.
 */
const pushUrgenciesSchema = z
	.array(gateUrgencySchema)
	.max(GATE_URGENCIES.length);

/** The Gate urgencies that push by default: only a Gate that needs an answer now. */
const DEFAULT_PUSH_URGENCIES: readonly GateUrgency[] = ["now"];

/** The urgencies once each, in the order now, today, later. */
function urgenciesOf(list: readonly GateUrgency[]): GateUrgency[] {
	return GATE_URGENCIES.filter((urgency) => list.includes(urgency));
}

export const notificationSettingsSchema = z.object({
	events: eventsSchema,
	/** No pushes in this daily window. Null: no quiet hours. */
	quietHours: quietHoursSchema.nullable(),
	/** The Person's time zone: quiet hours are in it. */
	timeZone: timeZoneSchema,
	screens: screensSchema,
	/** How long a push to a phone or a closed browser waits while a screen is open, in minutes. */
	holdMinutes: z.number().int().min(0).max(60),
	/** The Gate urgencies that push to phones, browsers and the desktop app. */
	pushUrgencies: pushUrgenciesSchema,
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** A change: only the fields given change. */
export const notificationSettingsPatchSchema = z
	.object({
		events: eventsSchema.partial().optional(),
		quietHours: quietHoursSchema.nullable().optional(),
		timeZone: timeZoneSchema.optional(),
		screens: screensSchema.partial().optional(),
		holdMinutes: notificationSettingsSchema.shape.holdMinutes.optional(),
		/** Absent: as it was. An older phone app saves without it. */
		pushUrgencies: pushUrgenciesSchema.optional(),
	})
	.strict();
export type NotificationSettingsPatch = z.infer<
	typeof notificationSettingsPatchSchema
>;

/** How long a push waits while a screen is open, by default. */
const DEFAULT_HOLD_MINUTES = 3;

/** The settings of a Person who never saved any, in this time zone. */
export function defaultSettings(timeZone: string): NotificationSettings {
	return {
		events: {
			gateOpened: true,
			runFinished: true,
			runFailed: true,
			deviceWait: true,
		},
		quietHours: null,
		timeZone,
		screens: { web: true, expo: true, desktop: true },
		holdMinutes: DEFAULT_HOLD_MINUTES,
		pushUrgencies: [...DEFAULT_PUSH_URGENCIES],
	};
}

/** The settings after a change. */
export function applyPatch(
	current: NotificationSettings,
	patch: NotificationSettingsPatch,
): NotificationSettings {
	return notificationSettingsSchema.parse({
		events: { ...current.events, ...patch.events },
		quietHours:
			patch.quietHours === undefined ? current.quietHours : patch.quietHours,
		timeZone: patch.timeZone ?? current.timeZone,
		screens: { ...current.screens, ...patch.screens },
		holdMinutes: patch.holdMinutes ?? current.holdMinutes,
		pushUrgencies: urgenciesOf(patch.pushUrgencies ?? current.pushUrgencies),
	});
}

/**
 * A Person's settings as the store kept them. The screens and the
 * urgencies may come from an older version, or be unreadable: `unknown`.
 */
export type StoredSettings = Omit<
	NotificationSettings,
	"screens" | "pushUrgencies"
> & { screens: unknown; pushUrgencies: unknown };

/**
 * The settings of what the store kept. A screen it cannot read takes its
 * default. Urgencies it cannot read push only for now. A time zone it
 * cannot read is `fallbackZone`.
 */
export function settingsOfStored(
	stored: StoredSettings,
	fallbackZone: string,
): NotificationSettings {
	const screens = screensSchema.partial().catch({}).parse(stored.screens);
	const defaults = defaultSettings(fallbackZone);
	return {
		events: stored.events,
		quietHours: stored.quietHours,
		timeZone: isTimeZone(stored.timeZone) ? stored.timeZone : fallbackZone,
		screens: { ...defaults.screens, ...screens },
		holdMinutes: stored.holdMinutes,
		pushUrgencies: urgenciesOf(
			pushUrgenciesSchema
				.catch([...DEFAULT_PUSH_URGENCIES])
				.parse(stored.pushUrgencies),
		),
	};
}

const minutesOf = (time: string) => {
	const [hour = 0, minute = 0] = time.split(":").map(Number);
	return hour * 60 + minute;
};

/** Whether a Gate of this urgency pushes to the Person's screens. */
export function pushesUrgency(
	settings: Pick<NotificationSettings, "pushUrgencies">,
	urgency: GateUrgency,
): boolean {
	return settings.pushUrgencies.includes(urgency);
}

/**
 * Whether `at` is in the Person's quiet hours. A window that ends before
 * it starts runs over midnight (22:00 to 07:00). A window that starts when
 * it ends is no window.
 */
export function inQuietHours(
	settings: Pick<NotificationSettings, "quietHours" | "timeZone">,
	at: number,
): boolean {
	const window = settings.quietHours;
	if (!window) return false;
	const start = minutesOf(window.start);
	const end = minutesOf(window.end);
	if (start === end) return false;
	const now = minuteOfDay(at, settings.timeZone);
	return start < end ? now >= start && now < end : now >= start || now < end;
}
