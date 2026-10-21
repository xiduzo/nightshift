/** The notify rules (what changed between two polls, whether the person wants to know, and the words), and the notification settings queries. */

export {
	applySettingsPatch,
	createNotificationMutations,
	createNotificationQueries,
	type NotificationSettings,
	type NotificationSettingsPatch,
	type PushTargetView,
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
