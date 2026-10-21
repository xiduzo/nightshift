/**
 * Test helpers of `@nightshift/notifications`: a fake push channel, run
 * events a test lands, a migrated database, and fakes of the desktop
 * notification's OS ports. Only tests import this entry.
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
	fakeChannel,
	fakeRunEvents,
} from "./fakes";
