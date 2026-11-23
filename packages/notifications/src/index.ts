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
	type PushKind,
	type PushTarget,
	type SendResult,
} from "./channels";
export { deliveryMoves, type NoticeKind } from "./deliveries";
export {
	createDesktopChannel,
	type DesktopNotice,
	type DesktopNotifier,
	type DesktopWindow,
	type DesktopWindowState,
	systemDesktopNotifier,
} from "./desktop";
export {
	type NotificationSettings,
	type NotificationSettingsPatch,
	notificationSettingsPatchSchema,
	notificationSettingsSchema,
	oneSenderPerSpace,
	type PushTargetView,
	pushKindSchema,
	type RegisterTarget,
	type RunEventSource,
	registerScreenSchema,
	type SenderFacts,
} from "./notifications";
export {
	createNotifications,
	engineRunEvents,
	type Notifications,
	type NotificationsOptions,
} from "./wire";
