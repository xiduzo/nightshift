import { pushDataOf, routeOf } from "@nightshift/client";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";

import { phoneRouteOf } from "./push-data";

/** Opens the screen of a tapped notification: the Gate, the run or the inbox. */
function open(response: Notifications.NotificationResponse): boolean {
	// A button answers in the background (`startPushHandling`).
	if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
		return false;
	}
	const data = pushDataOf(response.notification.request.content.data);
	if (!data) return false;
	router.push(phoneRouteOf(routeOf(data)));
	return true;
}

/**
 * A tap on a notification opens its screen, also when the tap started the
 * app. Use it once, in the root layout. Signed out, the screen sends the
 * person to sign in first.
 */
export function useNotificationTaps(): void {
	useEffect(() => {
		const last = Notifications.getLastNotificationResponse();
		if (last && open(last)) Notifications.clearLastNotificationResponse();
		const subscription = Notifications.addNotificationResponseReceivedListener(
			(response) => {
				if (open(response)) Notifications.clearLastNotificationResponse();
			},
		);
		return () => subscription.remove();
	}, []);
}
