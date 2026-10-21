import type { ApiQueryUtils } from "../api";

/** The query options of the person's notification settings and screens. */
export function createNotificationQueries(orpc: ApiQueryUtils) {
	return {
		/** Every notifications query. Invalidate it after a change. */
		all: () => orpc.notifications.key(),
		/** The person's notification settings. */
		settings: () => orpc.notifications.settings.get.queryOptions(),
		/** The browsers, phones and desktop apps that get the person's notifications. */
		screens: () => orpc.notifications.targets.list.queryOptions(),
		/** The public key a browser subscribes with. Null: no browser notifications. */
		webPushKey: () => ({
			...orpc.notifications.webPush.key.queryOptions(),
			staleTime: Number.POSITIVE_INFINITY,
		}),
	};
}

/**
 * The mutation options of the notification settings and screens. Removing
 * a phone also signs it out.
 */
export function createNotificationMutations(orpc: ApiQueryUtils) {
	return {
		saveSettings: orpc.notifications.settings.save.mutationOptions,
		registerScreen: orpc.notifications.targets.register.mutationOptions,
		removeScreen: orpc.notifications.targets.remove.mutationOptions,
	};
}
