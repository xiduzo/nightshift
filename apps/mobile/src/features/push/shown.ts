import { pushDataOf, type ShownNotifications } from "@nightshift/client";
import * as Notifications from "expo-notifications";

import { inFrontPlace, showBanner } from "./in-front";
import {
	type ShownNotification,
	showInFront,
	shownAtMs,
	shownWithKey,
} from "./push-data";

/** The notifications the phone shows now, with the Host's key of each. */
async function shown(): Promise<ShownNotification[]> {
	const presented = await Notifications.getPresentedNotificationsAsync();
	return presented.map((notification) => ({
		id: notification.request.identifier,
		key: pushDataOf(notification.request.content.data)?.key ?? null,
		at: shownAtMs(notification.date),
	}));
}

async function dismiss(ids: string[]): Promise<void> {
	await Promise.all(
		ids.map((id) =>
			Notifications.dismissNotificationAsync(id).catch(() => undefined),
		),
	);
}

/** Takes away the shown notifications of one key: its Gate was answered somewhere. */
export async function dismissKey(key: string): Promise<void> {
	await dismiss(shownWithKey(await shown(), key));
}

export function dismissOne(id: string): Promise<void> {
	return dismiss([id]);
}

/**
 * How this phone shows notifications, for the live cache: a Gate that
 * opens while the app is in front shows as a banner in the app, unless the
 * person looks at the inbox or at that Gate (`showInFront`). A closed Gate
 * takes its notifications away. When to show and when to take away is the
 * live cache's rule.
 */
export const phoneNotifications: ShownNotifications = {
	show(notice) {
		if (showInFront(notice.data, inFrontPlace())) {
			showBanner({ title: notice.title, data: notice.data });
		}
	},
	close: (key) => dismissKey(key),
	async list() {
		return (await shown()).map(({ id, key, at }) => ({
			key,
			at,
			dismiss: () => dismissOne(id),
		}));
	},
};
