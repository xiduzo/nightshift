import {
	defaultSettings,
	type NotificationSettings,
} from "../domain/notification-settings";
import type { SettingsStore } from "./ports";

export type FindSettingsPorts = {
	settingsStore: Pick<SettingsStore, "get">;
	/** The time zone of a Person who saved no settings. */
	timeZone: string;
};

/** Whose settings. */
export type FindSettings = { personId: string };

/**
 * A Person's notification settings, or the defaults when they saved none.
 * Night Shift asks, which decides whom to tell. A Person reads their own
 * through `readSettings`.
 */
export const findSettings =
	(ports: FindSettingsPorts) =>
	async (request: FindSettings): Promise<NotificationSettings> =>
		(await ports.settingsStore.get(request.personId)) ??
		defaultSettings(ports.timeZone);
