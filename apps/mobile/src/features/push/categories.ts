import {
	PUSH_ACTION,
	PUSH_ANDROID_CHANNEL,
	PUSH_CATEGORY,
} from "@nightshift/client";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * The buttons of a lock-screen Gate. The author marked the Gate, so the
 * answer goes without an unlock and without opening the app. An iOS
 * category has fixed button titles: they say Approve and Reject, and
 * answer the first and the second option of the Gate. Flow validation
 * holds a lock-screen Gate to two options, and the editor names the option
 * each button answers.
 */
const DECIDE_ACTIONS: Notifications.NotificationAction[] = [
	{
		identifier: PUSH_ACTION.approve,
		buttonTitle: "Approve",
		options: { opensAppToForeground: false, isAuthenticationRequired: false },
	},
	{
		identifier: PUSH_ACTION.reject,
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
		PUSH_CATEGORY.decide,
		DECIDE_ACTIONS,
	);
	await Notifications.setNotificationCategoryAsync(PUSH_CATEGORY.open, []);
	await Notifications.setNotificationCategoryAsync(PUSH_CATEGORY.run, []);
	if (Platform.OS !== "android") return;
	await Promise.all([
		Notifications.setNotificationChannelAsync(PUSH_ANDROID_CHANNEL.gates, {
			name: "Gates",
			description: "A Gate waits for your answer.",
			importance: Notifications.AndroidImportance.HIGH,
		}),
		Notifications.setNotificationChannelAsync(PUSH_ANDROID_CHANNEL.runs, {
			name: "Runs",
			description: "A run finished or failed.",
			importance: Notifications.AndroidImportance.DEFAULT,
		}),
	]);
}
