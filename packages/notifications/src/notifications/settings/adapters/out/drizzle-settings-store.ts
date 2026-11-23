import type { Database } from "@nightshift/db";
import { notificationSettings } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { eq } from "drizzle-orm";
import type { SettingsStore } from "../../application/ports";
import {
	type NotificationSettings,
	settingsOfStored,
} from "../../domain/notification-settings";

/** What the store stands on: the database, and the time zone of a row whose zone it cannot read. */
export type DrizzleSettingsStoreDeps = { db: Database; timeZone: string };

/**
 * `SettingsStore` over drizzle: one row per Person in
 * `notification_settings`. The screens and the urgencies are JSON text.
 * `wireSettings` builds it.
 */
export function drizzleSettingsStore(
	deps: DrizzleSettingsStoreDeps,
): SettingsStore {
	const { db } = deps;

	function fromRow(
		row: typeof notificationSettings.$inferSelect,
	): NotificationSettings {
		return settingsOfStored(
			{
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
				timeZone: row.timeZone,
				screens: safeJson(row.screens),
				holdMinutes: row.holdMinutes,
				pushUrgencies: safeJson(row.pushUrgencies, null),
			},
			deps.timeZone,
		);
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
			pushUrgencies: JSON.stringify(settings.pushUrgencies),
			updatedAt: asDate(),
		};
	}

	return {
		async get(personId) {
			const [row] = await db
				.select()
				.from(notificationSettings)
				.where(eq(notificationSettings.personId, personId));
			return row ? fromRow(row) : null;
		},
		async put(personId, settings) {
			const row = toRow(personId, settings);
			await db.insert(notificationSettings).values(row).onConflictDoUpdate({
				target: notificationSettings.personId,
				set: row,
			});
		},
		async putIfAbsent(personId, settings) {
			await db
				.insert(notificationSettings)
				.values(toRow(personId, settings))
				.onConflictDoNothing();
		},
	};
}

function safeJson(text: string, fallback: unknown = {}): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return fallback;
	}
}
