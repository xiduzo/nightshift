import type { Actor } from "@nightshift/engine";
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

/** Whose settings, and the change: only the fields given change. */
export type SaveSettings = {
	personId: string;
	patch: NotificationSettingsPatch;
};

/**
 * Saves a change of a Person's notification settings and returns them
 * all. A time or a time zone it cannot read throws, and nothing is saved.
 * Who asks: the Person, for their own. No role applies.
 */
export const saveSettings =
	(ports: SaveSettingsPorts) =>
	async (
		_actor: Actor,
		request: SaveSettings,
	): Promise<NotificationSettings> => {
		const { personId } = request;
		const patch = notificationSettingsPatchSchema.parse(request.patch);
		const current =
			(await ports.settingsStore.get(personId)) ??
			defaultSettings(ports.timeZone);
		const next = applyPatch(current, patch);
		await ports.settingsStore.put(personId, next);
		return next;
	};
