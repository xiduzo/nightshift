/**
 * Notifications: the stream of what happens in every Space the person is
 * in, their settings and screens, and the words of a notice.
 */

export { HOLD_MINUTES, holdLabel } from "./hold";
export {
	isGateKey,
	PUSH_ACTION,
	PUSH_ANDROID_CHANNEL,
	PUSH_CATEGORY,
	PUSH_MESSAGE_KINDS,
	type PushMessageKind,
} from "./push";
export {
	applySettingsPatch,
	createNotificationMutations,
	createNotificationQueries,
} from "./queries";
export { describeNotice } from "./rules";
export { followNotifications } from "./stream";
export type {
	NotificationItem,
	NotificationScreen,
	NotificationSettings,
	NotificationSettingsPatch,
} from "./types";
