import {
	glanceSnapshot,
	isGateClosed,
	PUSH_ANDROID_CHANNEL,
	PUSH_CATEGORY,
} from "@nightshift/client";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { AppState, Platform } from "react-native";

import { updateGlance } from "@/features/glance";
import { savedHost } from "@/features/host";
import { defineCategories } from "./categories";
import { inFrontPlace, showBanner } from "./in-front";
import {
	answerOfAction,
	type PushData,
	pushDataOf,
	showInFront,
	taskDataOf,
	withdrawKeyOf,
} from "./push-data";
import { dismissKey, dismissOne } from "./shown";

/** The background task that gets the Host's pushes while the app is not in front. */
const TASK = "nightshift-push";

/** The responses this run of the app handled already: a response can come twice. */
const handled = new Set<string>();

/**
 * Answers a Gate from a button on its notification, with the app in the
 * background or not running. The answer is bound to the run and the step
 * of the push. A Gate that closed in the meantime takes no answer: the
 * phone does nothing more. Then the notification goes away.
 */
async function answerFromButton(
	response: Notifications.NotificationResponse,
): Promise<void> {
	const { identifier, content } = response.notification.request;
	const data = pushDataOf(content.data);
	const answer = answerOfAction(response.actionIdentifier, data);
	if (!answer || !data) return;
	const once = `${identifier}:${response.actionIdentifier}`;
	if (handled.has(once)) return;
	handled.add(once);
	try {
		const host = await savedHost();
		if (!host) throw new Error("This phone has no Host.");
		await host.client.gates.resolve(answer);
	} catch (error) {
		if (!isGateClosed(error)) await tellNotSent(data);
	} finally {
		Notifications.clearLastNotificationResponse();
		await dismissOne(identifier);
	}
}

/**
 * The answer did not reach the Host: a notification says so, and a tap
 * opens the Gate to answer it there. Same key, so a withdraw clears it.
 */
async function tellNotSent(data: PushData): Promise<void> {
	const { options: _buttons, ...ids } = data;
	await Notifications.scheduleNotificationAsync({
		content: {
			title: "Your answer was not sent",
			body: "Night Shift could not reach your Host. Open the Gate to answer it.",
			data: ids,
			categoryIdentifier: PUSH_CATEGORY.open,
		},
		trigger:
			Platform.OS === "android"
				? { channelId: PUSH_ANDROID_CHANNEL.gates }
				: null,
	}).catch(() => undefined);
}

/**
 * Reads the open Gates and the latest runs again for the home screen
 * widget, so it is right while the app is not in front. Without a Host the
 * widget shows nothing. A failed read keeps what the widget shows.
 */
async function refreshGlance(): Promise<void> {
	const host = await savedHost();
	if (!host) {
		updateGlance(null);
		return;
	}
	const [gates, runs] = await Promise.all([
		host.client.gates.list(),
		host.client.runs.list({}),
	]);
	updateGlance(glanceSnapshot({ gates, runs }));
}

/**
 * The background task: a withdraw push takes away the notification of its
 * key. On Android a button on a notification also comes here when the app
 * does not run. Either way the home screen widget reads the Gates and runs
 * again.
 */
async function onTask({
	data,
}: TaskManager.TaskManagerTaskBody<Notifications.NotificationTaskPayload>) {
	if (data && "actionIdentifier" in data) {
		await answerFromButton(data);
		await refreshGlance().catch(() => undefined);
		return Notifications.BackgroundNotificationTaskResult.NoData;
	}
	const key = withdrawKeyOf(taskDataOf(data));
	if (!key) return Notifications.BackgroundNotificationTaskResult.NoData;
	await dismissKey(key).catch(() => undefined);
	await refreshGlance().catch(() => undefined);
	return Notifications.BackgroundNotificationTaskResult.NewData;
}

/**
 * How a push shows while the app is in front: never as the phone's own
 * banner. A Gate shows as a banner in the app instead, unless the person
 * already looks at the inbox or at that Gate. In the background the phone
 * shows the push as it came.
 */
function handleInFront(
	notification: Notifications.Notification,
): Notifications.NotificationBehavior {
	if (AppState.currentState !== "active") {
		return {
			shouldShowBanner: true,
			shouldShowList: true,
			shouldPlaySound: true,
			shouldSetBadge: false,
		};
	}
	const data = pushDataOf(notification.request.content.data);
	const isGate = data?.kind === "gate-opened" || data?.kind === "gates-waiting";
	const shows = showInFront(data, inFrontPlace());
	if (data && shows) {
		showBanner({
			title: notification.request.content.title ?? "A Gate waits for you",
			data,
		});
	}
	return {
		shouldShowBanner: false,
		// A Gate the person looks at stays out of the list too.
		shouldShowList: isGate ? shows : true,
		shouldPlaySound: false,
		shouldSetBadge: false,
	};
}

let started = false;

/**
 * Starts the push handling of the app. Call it once, in the module scope
 * of the root layout: the background task must be defined when iOS or
 * Android starts the app for a push, before any screen renders.
 */
export function startPushHandling(): void {
	if (started) return;
	started = true;
	TaskManager.defineTask(TASK, onTask);
	void Notifications.registerTaskAsync(TASK).catch(() => undefined);
	void defineCategories().catch(() => undefined);
	Notifications.setNotificationHandler({
		handleNotification: async (notification) => handleInFront(notification),
	});
	// A button on a notification. Taps open a screen: `useNotificationTaps`.
	Notifications.addNotificationResponseReceivedListener((response) => {
		void answerFromButton(response);
	});
	// iOS keeps the response that started the app before this listener.
	const last = Notifications.getLastNotificationResponse();
	if (last) void answerFromButton(last);
	// A withdraw push that comes while the app is in front.
	Notifications.addNotificationReceivedListener((notification) => {
		const key = withdrawKeyOf(notification.request.content.data);
		if (key) void dismissKey(key).catch(() => undefined);
	});
}
