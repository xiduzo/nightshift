import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { ACTION, ANDROID_CHANNEL, CATEGORY } from "./push-data";

/**
 * The buttons of a lock-screen Gate. The author marked the Gate, so the
 * answer goes without an unlock and without opening the app. An iOS
 * category has fixed button titles: they say Approve and Reject, and
 * answer the first and the second option of the Gate.
 */
const DECIDE_ACTIONS: Notifications.NotificationAction[] = [
	{
		identifier: ACTION.approve,
		buttonTitle: "Approve",
		options: { opensAppToForeground: false, isAuthenticationRequired: false },
	},
	{
		identifier: ACTION.reject,
		buttonTitle: "Reject",
		options: {
			opensAppToForeground: false,
			isAuthenticationRequired: false,
			isDestructive: true,
		},
	},
];

/**
 * Defines what the Host's pushes need on this phone: the three categories
 * and, on Android, the two channels. Safe to call at every start.
 */
export async function defineCategories(): Promise<void> {
	// One at a time: iOS sets the whole list each time, so two at once
	// would keep only one of them.
	await Notifications.setNotificationCategoryAsync(
		CATEGORY.decide,
		DECIDE_ACTIONS,
	);
	await Notifications.setNotificationCategoryAsync(CATEGORY.open, []);
	await Notifications.setNotificationCategoryAsync(CATEGORY.run, []);
	if (Platform.OS !== "android") return;
	await Promise.all([
		Notifications.setNotificationChannelAsync(ANDROID_CHANNEL.gates, {
			name: "Gates",
			description: "A Gate waits for your answer.",
			importance: Notifications.AndroidImportance.HIGH,
		}),
		Notifications.setNotificationChannelAsync(ANDROID_CHANNEL.runs, {
			name: "Runs",
			description: "A run finished or failed.",
			importance: Notifications.AndroidImportance.DEFAULT,
		}),
	]);
}
