// The API of `@nightshift/notifications`: the notifier and what the API and
// the daemon need of it. `wire.ts` composes the verticals. Fakes are in
// `./testing`.

export {
	createExpoChannel,
	createInAppChannel,
	type ExpoChannel,
	type ExpoChannelOptions,
	type ExpoClient,
	type InAppChannel,
	type InAppItem,
	type InAppTarget,
	type NotificationChannel,
	type NotificationMessage,
	type PushChannels,
	type SendResult,
} from "./channels";
export { moveDeliveriesBatch, type NoticeKind } from "./deliveries";
export {
	createDesktopChannel,
	type DesktopNotice,
	type DesktopNotifier,
	type DesktopWindow,
	type DesktopWindowState,
	systemDesktopNotifier,
} from "./desktop";
export {
	engineRunEvents,
	oneSenderPerSpace,
	type RunEvent,
	type RunEventSource,
	type SenderFacts,
} from "./notifier";
export {
	type NotificationSettings,
	type NotificationSettingsPatch,
	notificationSettingsPatchSchema,
	notificationSettingsSchema,
} from "./settings";
export {
	type PushKind,
	type PushTarget,
	type PushTargetView,
	pushKindSchema,
	type RegisterTarget,
	registerScreenSchema,
} from "./targets";
export {
	createNotifications,
	type Notifications,
	type NotificationsOptions,
} from "./wire";
