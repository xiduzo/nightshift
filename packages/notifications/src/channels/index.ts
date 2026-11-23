/** The channels: the port every way to reach a screen implements, the in-app stream, the push slots, and Web Push with its VAPID keys. */

export type {
	InAppTarget,
	NotificationChannel,
	NotificationMessage,
	PushChannels,
	SendResult,
} from "./channel";
export {
	createExpoChannel,
	type ExpoChannel,
	type ExpoChannelOptions,
	type ExpoClient,
} from "./expo";
export {
	createInAppChannel,
	type InAppChannel,
	type InAppItem,
	type WatchOptions,
} from "./in-app";
export type { PushKind, PushTarget } from "./push-target";
export { createVapidKeyStore, type VapidKeys } from "./vapid-keys";
export { createWebPushChannel, type WebPushSender } from "./web-push";
