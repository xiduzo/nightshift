/**
 * Test helpers of `@nightshift/notifications`: a fake push channel, run
 * events a test lands, and a migrated database. Only tests import this
 * entry.
 */
export { testDatabase } from "./database";
export {
	type ChannelCall,
	type FakeChannel,
	type FakeRunEvents,
	fakeChannel,
	fakeRunEvents,
} from "./fakes";
