/**
 * Notifications: the stream of what happens in every Space the person is
 * in, their settings and screens, and the notify rules: what changed
 * between two reads, whether the person wants to know, and the words.
 */

export {
	applySettingsPatch,
	createNotificationMutations,
	createNotificationQueries,
} from "./queries";
export {
	compareGates,
	compareRuns,
	describeNotice,
	gateKey,
	isWanted,
	type Notice,
	type NoticeChoices,
} from "./rules";
export {
	type FollowNotificationsOptions,
	followNotifications,
	type NotificationWatchClient,
} from "./stream";
export type {
	NotificationItem,
	NotificationScreen,
	NotificationSettings,
	NotificationSettingsPatch,
	RegisterScreenInput,
} from "./types";
