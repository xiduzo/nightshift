/** The channels: the port every way to reach a screen implements, the in-app stream, and the push slots. */

export {
	type GateFacts,
	gateKey,
	gatesWaitingTitle,
	type InAppTarget,
	type NotificationChannel,
	type NotificationMessage,
	type PushChannels,
	parseGateKey,
	runEndKey,
	type SendResult,
	titleOf,
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
} from "./in-app";
