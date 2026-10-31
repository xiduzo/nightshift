/**
 * Notifications: the stream of what happens in every Space the person is
 * in, their settings and screens, the words of a notice, and the push
 * contract (keys, push data, where a tap goes).
 */

export { digestShown } from "./digest";
export { PHONE_DELAYS, phoneDelayLabel } from "./phone-delay";
export {
	gateKey,
	PUSH_ACTION,
	PUSH_ANDROID_CHANNEL,
	PUSH_CATEGORY,
	type PushData,
	type PushRoute,
	pushDataOf,
	routeOf,
	type ShownNotification,
	staleGates,
	webPathOf,
	withdrawKeyOf,
} from "./push";
export {
	applySettingsPatch,
	createNotificationQueries,
} from "./queries";
export { describeNotice } from "./rules";
export { followNotifications, type NotificationWatchClient } from "./stream";
export type {
	Digest,
	NotificationItem,
	NotificationScreen,
	NotificationSettings,
	NotificationSettingsPatch,
} from "./types";
