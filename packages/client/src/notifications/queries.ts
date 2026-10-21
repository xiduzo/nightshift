import type { ApiInputs, ApiOutputs, ApiQueryUtils } from "../api";

/** A Person's notification settings: which events, quiet hours, which screens, the phone delay. */
export type NotificationSettings =
	ApiOutputs["notifications"]["settings"]["get"];

/** A change of the notification settings: only the fields given change. */
export type NotificationSettingsPatch =
	ApiInputs["notifications"]["settings"]["save"];

/**
 * The settings with a change applied, as the Host saves them: events and
 * screens merge, the rest replaces. A screen shows it before the Host answers.
 */
export function applySettingsPatch(
	settings: NotificationSettings,
	patch: NotificationSettingsPatch,
): NotificationSettings {
	return {
		events: { ...settings.events, ...patch.events },
		quietHours:
			patch.quietHours === undefined ? settings.quietHours : patch.quietHours,
		timeZone: patch.timeZone ?? settings.timeZone,
		screens: { ...settings.screens, ...patch.screens },
		holdMinutes: patch.holdMinutes ?? settings.holdMinutes,
	};
}

/** A browser, phone or desktop app that gets the Person's notifications. */
export type PushTargetView =
	ApiOutputs["notifications"]["targets"]["list"][number];

/** The query options of the signed-in Person's notification settings and screens. */
export function createNotificationQueries(orpc: ApiQueryUtils) {
	return {
		/** The Person's notification settings. They are the same on every screen. */
		settings: () => orpc.notifications.settings.get.queryOptions(),
		/** The browsers, phones and desktop apps that get the Person's notifications. */
		targets: () => orpc.notifications.targets.list.queryOptions(),
		/** Every query of the screens. Invalidate it after one is registered or removed. */
		targetsKey: () => orpc.notifications.targets.list.key(),
	};
}

/** The mutation options of notification settings and screens. */
export function createNotificationMutations(orpc: ApiQueryUtils) {
	return {
		/** Saves a change; answers with every setting. */
		saveSettings: orpc.notifications.settings.save.mutationOptions,
		register: orpc.notifications.targets.register.mutationOptions,
		remove: orpc.notifications.targets.remove.mutationOptions,
	};
}
