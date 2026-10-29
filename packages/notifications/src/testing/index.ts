/**
 * Test helpers of `@nightshift/notifications`: run events a test lands, a
 * fake Web Push sender and VAPID keys. Only tests import this entry.
 */

export {
	type FakeRunEvents,
	type FakeWebPushSender,
	fakeRunEvents,
	fakeVapidKeys,
	fakeWebPushSender,
} from "./fakes";
