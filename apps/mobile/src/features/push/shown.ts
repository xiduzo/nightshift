import { pushDataOf, staleGates } from "@nightshift/client";
import * as Notifications from "expo-notifications";

import { type ShownNotification, shownAtMs, shownWithKey } from "./push-data";

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

/** Takes away the shown Gate notifications whose Gate no longer waits, as a read at `readAt` says. */
export async function dismissClosed(
	openKeys: ReadonlySet<string>,
	readAt: number,
): Promise<void> {
	const stale = staleGates(await shown(), openKeys, readAt);
	await dismiss(stale.map((item) => item.id));
}

export function dismissOne(id: string): Promise<void> {
	return dismiss([id]);
}
