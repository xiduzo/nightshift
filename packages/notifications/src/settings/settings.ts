import type { Database } from "@nightshift/db";
import { notificationSettings } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
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

/** Whether this runtime knows the IANA time zone. */
function isTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

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

export const notificationSettingsSchema = z.object({
	events: eventsSchema,
	/** No pushes in this daily window. Null: no quiet hours. */
	quietHours: quietHoursSchema.nullable(),
	/** The Person's time zone: quiet hours are in it. */
	timeZone: timeZoneSchema,
	screens: screensSchema,
	/** How long a push to a phone or a closed browser waits while a screen is open, in minutes. */
	holdMinutes: z.number().int().min(0).max(60),
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
	})
	.strict();
export type NotificationSettingsPatch = z.infer<
	typeof notificationSettingsPatchSchema
>;

/** How long a push waits while a screen is open, by default. */
export const DEFAULT_HOLD_MINUTES = 3;

/** This computer's time zone, else UTC. */
export function localTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/** The settings of a Person who never saved any. */
export function defaultSettings(
	timeZone: string = localTimeZone(),
): NotificationSettings {
	return {
		events: { gateOpened: true, runFinished: true, runFailed: true },
		quietHours: null,
		timeZone,
		screens: { web: true, expo: true, desktop: true },
		holdMinutes: DEFAULT_HOLD_MINUTES,
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
	});
}

/** The minutes since midnight of `at` in the time zone. */
function minuteOfDay(at: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(at));
	const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
	const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
	return hour * 60 + minute;
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
			},
			quietHours:
				row.quietStart && row.quietEnd
					? { start: row.quietStart, end: row.quietEnd }
					: null,
			timeZone: isTimeZone(row.timeZone) ? row.timeZone : fallbackZone,
			screens: { ...defaults.screens, ...screens },
			holdMinutes: row.holdMinutes,
		};
	}

	function toRow(personId: string, settings: NotificationSettings) {
		return {
			personId,
			gateOpened: settings.events.gateOpened,
			runFinished: settings.events.runFinished,
			runFailed: settings.events.runFailed,
			quietStart: settings.quietHours?.start ?? null,
			quietEnd: settings.quietHours?.end ?? null,
			timeZone: settings.timeZone,
			screens: JSON.stringify(settings.screens),
			holdMinutes: settings.holdMinutes,
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

	return {
		/** The Person's settings, or the defaults. */
		get,

		/** Saves a change of the Person's settings and returns them all. */
		async save(
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
		},

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
	};
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return {};
	}
}
