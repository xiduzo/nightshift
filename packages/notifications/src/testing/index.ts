/**
 * Test helpers of `@nightshift/notifications`: a fake push channel, run
 * events a test lands, a fake Web Push sender and VAPID keys, and a
 * migrated database. Only tests import this entry.
 */
export { testDatabase } from "./database";
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
