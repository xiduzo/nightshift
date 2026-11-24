import type { PersonActor } from "@nightshift/engine";
import {
	applyPatch,
	defaultSettings,
	type NotificationSettings,
	type NotificationSettingsPatch,
	notificationSettingsPatchSchema,
} from "../domain/notification-settings";
import type { SettingsStore } from "./ports";

export type SaveSettingsPorts = {
	settingsStore: Pick<SettingsStore, "get" | "put">;
	/** The time zone of a Person who saved no settings. */
	timeZone: string;
};

/** The change: only the fields given change. */
export type SaveSettings = { patch: NotificationSettingsPatch };

/**
 * Saves a change of the notification settings of the Person who asks, and
 * returns them all. A time or a time zone it cannot read throws, and
 * nothing is saved. No role applies, and nobody changes another's.
 */
export const saveSettings =
	(ports: SaveSettingsPorts) =>
	async (
		actor: PersonActor,
		request: SaveSettings,
	): Promise<NotificationSettings> => {
		const { personId } = actor;
		const patch = notificationSettingsPatchSchema.parse(request.patch);
		const current =
			(await ports.settingsStore.get(personId)) ??
			defaultSettings(ports.timeZone);
		const next = applyPatch(current, patch);
		await ports.settingsStore.put(personId, next);
		return next;
	};
