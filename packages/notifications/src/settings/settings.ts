import type { Database } from "@nightshift/db";
import { notificationSettings } from "@nightshift/db/schema";
import { dayKey, isTimeZone, localZone, minuteOfDay } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { z } from "zod";

/**
 * A Person's notification settings: which events, quiet hours, which
 * screens, how long a phone waits while another screen is open, and when
 * the morning digest goes out. They
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

/**
 * When the morning digest goes out: never (`off`), when quiet hours end
 * (`quiet-hours-end`; without quiet hours at `time`), or at `time`.
 */
const DIGEST_WHEN = ["off", "quiet-hours-end", "time"] as const;

const digestSchema = z.object({
	when: z.enum(DIGEST_WHEN),
	/** `HH:MM` in the Person's time zone. */
	time: timeOfDaySchema,
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

export const notificationSettingsSchema = z.object({
	events: eventsSchema,
	/** No pushes in this daily window. Null: no quiet hours. */
	quietHours: quietHoursSchema.nullable(),
	/** The Person's time zone: quiet hours are in it. */
	timeZone: timeZoneSchema,
	screens: screensSchema,
	/** How long a push to a phone or a closed browser waits while a screen is open, in minutes. */
	holdMinutes: z.number().int().min(0).max(60),
	/** The morning digest: the runs that ended since the last one, and the Gates that wait. */
	digest: digestSchema,
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
		digest: digestSchema.partial().optional(),
	})
	.strict();
export type NotificationSettingsPatch = z.infer<
	typeof notificationSettingsPatchSchema
>;

/** How long a push waits while a screen is open, by default. */
export const DEFAULT_HOLD_MINUTES = 3;

/** The digest of a Person who never chose: when quiet hours end, else at 08:00. */
const DEFAULT_DIGEST: NotificationSettings["digest"] = {
	when: "quiet-hours-end",
	time: "08:00",
};

/**
 * This computer's three notification switches: its own settings from
 * before notification settings moved to the Person.
 */
export type ComputerSwitches = {
	notifyGateOpened: boolean;
	notifyRunFinished: boolean;
	notifyRunFailed: boolean;
};

const SWITCH_KEYS = [
	"notifyGateOpened",
	"notifyRunFinished",
	"notifyRunFailed",
] as const;

/** The Person's events that the computer's switches stand for. The computer had no switch for a device wait. */
export function eventsOfSwitches(
	switches: ComputerSwitches,
): Omit<NotificationSettings["events"], "deviceWait"> {
	return {
		gateOpened: switches.notifyGateOpened,
		runFinished: switches.notifyRunFinished,
		runFailed: switches.notifyRunFailed,
	};
}

/** This computer's time zone, else UTC. */
export function localTimeZone(): string {
	return localZone();
}

/** The settings of a Person who never saved any. */
export function defaultSettings(
	timeZone: string = localTimeZone(),
): NotificationSettings {
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
		digest: DEFAULT_DIGEST,
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
		digest: { ...current.digest, ...patch.digest },
	});
}

const minutesOf = (time: string) => {
	const [hour = 0, minute = 0] = time.split(":").map(Number);
	return hour * 60 + minute;
};

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

/**
 * The time of day the Person's digest goes out, `HH:MM`: the end of their
 * quiet hours, or the time they chose. Null: they turned it off.
 */
export function digestTime(
	settings: Pick<NotificationSettings, "digest" | "quietHours">,
): string | null {
	const { when, time } = settings.digest;
	if (when === "off") return null;
	const window = settings.quietHours;
	if (when === "quiet-hours-end" && window && window.start !== window.end) {
		return window.end;
	}
	return time;
}

/**
 * The day whose digest is due at `at`, `YYYY-MM-DD` in the Person's time
 * zone: its time came today, and it is not quiet hours. A digest that did
 * not go out at its time (the computer was off) goes later that day. Null:
 * none is due, or the Person turned it off.
 */
export function digestDay(
	settings: Pick<NotificationSettings, "digest" | "quietHours" | "timeZone">,
	at: number,
): string | null {
	const time = digestTime(settings);
	if (time === null || inQuietHours(settings, at)) return null;
	if (minuteOfDay(at, settings.timeZone) < minutesOf(time)) return null;
	return dayKey(at, settings.timeZone);
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function createSettingsStore(
	db: Database,
	options: { timeZone?: string } = {},
) {
	const fallbackZone = options.timeZone ?? localTimeZone();

	function fromRow(
		row: typeof notificationSettings.$inferSelect,
	): NotificationSettings {
		const screens = screensSchema
			.partial()
			.catch({})
			.parse(safeJson(row.screens));
		const defaults = defaultSettings(fallbackZone);
		return {
			events: {
				gateOpened: row.gateOpened,
				runFinished: row.runFinished,
				runFailed: row.runFailed,
				deviceWait: row.deviceWait,
			},
			quietHours:
				row.quietStart && row.quietEnd
					? { start: row.quietStart, end: row.quietEnd }
					: null,
			timeZone: isTimeZone(row.timeZone) ? row.timeZone : fallbackZone,
			screens: { ...defaults.screens, ...screens },
			holdMinutes: row.holdMinutes,
			digest: digestSchema.catch(defaults.digest).parse({
				when: row.digestWhen,
				time: row.digestTime,
			}),
		};
	}

	function toRow(personId: string, settings: NotificationSettings) {
		return {
			personId,
			gateOpened: settings.events.gateOpened,
			runFinished: settings.events.runFinished,
			runFailed: settings.events.runFailed,
			deviceWait: settings.events.deviceWait,
			quietStart: settings.quietHours?.start ?? null,
			quietEnd: settings.quietHours?.end ?? null,
			timeZone: settings.timeZone,
			screens: JSON.stringify(settings.screens),
			holdMinutes: settings.holdMinutes,
			digestWhen: settings.digest.when,
			digestTime: settings.digest.time,
			updatedAt: new Date(),
		};
	}

	async function get(personId: string): Promise<NotificationSettings> {
		const [row] = await db
			.select()
			.from(notificationSettings)
			.where(eq(notificationSettings.personId, personId));
		return row ? fromRow(row) : defaultSettings(fallbackZone);
	}

	/** Saves a change of the Person's settings and returns them all. */
	async function save(
		personId: string,
		patch: NotificationSettingsPatch,
	): Promise<NotificationSettings> {
		const parsed = notificationSettingsPatchSchema.parse(patch);
		const next = applyPatch(await get(personId), parsed);
		const row = toRow(personId, next);
		await db.insert(notificationSettings).values(row).onConflictDoUpdate({
			target: notificationSettings.personId,
			set: row,
		});
		return next;
	}

	return {
		/** The Person's settings, or the defaults. */
		get,

		/** Saves a change of the Person's settings and returns them all. */
		save,

		/**
		 * Gives a Person who has no settings yet these choices, once: the
		 * copy of the settings a computer kept before they moved to the
		 * Person. A Person with a row keeps it.
		 */
		async seed(
			personId: string,
			events: Partial<NotificationSettings["events"]>,
		): Promise<void> {
			const settings = applyPatch(defaultSettings(fallbackZone), { events });
			await db
				.insert(notificationSettings)
				.values(toRow(personId, settings))
				.onConflictDoNothing();
		},

		/**
		 * After a save of the computer's settings that changed one of its
		 * three switches: the Person's events take the switches' values, for
		 * a client that still sends them. A save without them changes nothing.
		 */
		async adoptComputerSwitches(
			personId: string,
			patch: Partial<Record<keyof ComputerSwitches, unknown>>,
			switches: ComputerSwitches,
		): Promise<void> {
			if (!SWITCH_KEYS.some((key) => patch[key] !== undefined)) return;
			await save(personId, { events: eventsOfSwitches(switches) });
		},
	};
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}
