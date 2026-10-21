import * as Notifications from "expo-notifications";

import {
	pushDataOf,
	type ShownNotification,
	shownButClosed,
	shownWithKey,
} from "./push-data";

/** The notifications the phone shows now, with the Host's key of each. */
async function shown(): Promise<ShownNotification[]> {
	const presented = await Notifications.getPresentedNotificationsAsync();
	return presented.map((notification) => ({
		id: notification.request.identifier,
		key: pushDataOf(notification.request.content.data)?.key ?? null,
		at: notification.date,
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

/** Takes away the shown Gate notifications whose Gate no longer waits, as a read at `readAt` says. */
export async function dismissClosed(
	openKeys: ReadonlySet<string>,
	readAt: number,
): Promise<void> {
	await dismiss(shownButClosed(await shown(), openKeys, readAt));
}

export function dismissOne(id: string): Promise<void> {
	return dismiss([id]);
}
