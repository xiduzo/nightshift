/**
 * The notification contract: the keys of a notification, what a push
 * carries, and where a tap goes. Every screen reads the same rules: the
 * Host, the browser, the desktop app and the phone. It imports nothing, so
 * it runs in a browser, in React Native and in Bun.
 */

export {
	deviceWaitKey,
	gateKey,
	isGateKey,
	needsALookKey,
	parseDeviceWaitKey,
	parseGateKey,
	parseNeedsALookKey,
	runEndKey,
	scheduleMissedKey,
	waitingKey,
} from "./keys";
export { type LookSignal, signalTitle } from "./look";
export {
	type GateOption,
	PUSH_ACTION,
	PUSH_ANDROID_CHANNEL,
	PUSH_CATEGORY,
	type PushData,
	type PushMessageKind,
	pushDataOf,
	withdrawData,
	withdrawKeyOf,
} from "./push";
export { type PushRoute, routeOf, webPathOf } from "./routes";
