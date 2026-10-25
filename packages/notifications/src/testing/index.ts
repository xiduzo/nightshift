/**
 * Test helpers of `@nightshift/notifications`: a fake push channel, a fake
 * Expo push service, run events a test lands, a fake Web Push sender and
 * VAPID keys, fakes of the desktop notification's OS ports, and a migrated
 * database. Only tests import this entry.
 */

export type {
	FakeDesktopNotifier,
	FakePrograms,
} from "./desktop";
export type { FakeExpoClient } from "./expo";
export {
	type ChannelCall,
	type FakeChannel,
	type FakeRunEvents,
	type FakeWebPushSender,
	fakeRunEvents,
	fakeVapidKeys,
	fakeWebPushSender,
} from "./fakes";
