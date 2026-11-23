import type { Actor } from "@nightshift/engine";
import {
	defaultSettings,
	type NotificationSettings,
} from "../domain/notification-settings";
import type { SettingsStore } from "./ports";

export type ReadSettingsPorts = {
	settingsStore: Pick<SettingsStore, "get">;
	/** The time zone of a Person who saved no settings. */
	timeZone: string;
};

/** Whose settings. */
export type ReadSettings = { personId: string };

/**
 * Reads a Person's notification settings, or the defaults when they saved
 * none. Who asks: the Person, for their own (the door passes their id),
 * or Night Shift, which decides whom to tell. No role applies: the
 * settings belong to the Person, not to a Space.
 */
export const readSettings =
	(ports: ReadSettingsPorts) =>
	async (_actor: Actor, request: ReadSettings): Promise<NotificationSettings> =>
		(await ports.settingsStore.get(request.personId)) ??
		defaultSettings(ports.timeZone);
