/**
 * Notifications: the stream of what happens in every Space the person is
 * in, their settings and screens, and the words of a notice.
 */

export { PHONE_DELAYS, phoneDelayLabel } from "./phone-delay";
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
