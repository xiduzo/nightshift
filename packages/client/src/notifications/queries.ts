import type { ApiQueryUtils } from "../api";
import type { NotificationSettings, NotificationSettingsPatch } from "./types";

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
		digest: { ...settings.digest, ...patch.digest },
	};
}

/** The query options of the person's notification settings and screens. */
export function createNotificationQueries(orpc: ApiQueryUtils) {
	return {
		/** Every notifications query. Invalidate it after a change. */
		all: () => orpc.notifications.key(),
		/** The person's notification settings. */
		settings: () => orpc.notifications.settings.get.queryOptions(),
		/** The browsers, phones and desktop apps that get the person's notifications. */
		screens: () => orpc.notifications.targets.list.queryOptions(),
		/** The person's last morning digest, read again now. Null: none went out yet. */
		digest: () => orpc.notifications.digest.latest.queryOptions(),
		/** The public key a browser subscribes with. Null: no browser notifications. */
		webPushKey: () => ({
			...orpc.notifications.webPush.key.queryOptions(),
			staleTime: Number.POSITIVE_INFINITY,
		}),
	};
}
