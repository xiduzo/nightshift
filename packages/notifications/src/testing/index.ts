/**
 * Test helpers of `@nightshift/notifications`: a fake push channel, run
 * events a test lands, a fake Web Push sender and VAPID keys, fakes of
 * the desktop notification's OS ports, and a migrated database. Only
 * tests import this entry.
 */
export { testDatabase } from "./database";
export {
	type FakeDesktopNotifier,
	type FakePrograms,
	fakeDesktopNotifier,
	fakePrograms,
} from "./desktop";
export {
	type ChannelCall,
	type FakeChannel,
	type FakeRunEvents,
	type FakeWebPushSender,
	fakeChannel,
	fakeRunEvents,
	fakeVapidKeys,
	fakeWebPushSender,
} from "./fakes";
