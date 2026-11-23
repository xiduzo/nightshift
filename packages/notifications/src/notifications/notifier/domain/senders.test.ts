import { describe, expect, test } from "bun:test";
import { oneSenderPerSpace } from "./senders";

/** One sender per Space. The twins of the tests of the same names in `notifier.test.ts`. */

const facts = (isHost: boolean, elsewhere: string[], personal: string | null) =>
	oneSenderPerSpace({
		isHost: () => isHost,
		hostedElsewhere: async (spaceId) => elsewhere.includes(spaceId),
		ownPersonalSpaceId: async () => personal,
	});

describe("one sender per Space", () => {
	test("a Host sends for the Spaces it keeps, never for one another Host keeps", async () => {
		const sendsFor = facts(true, ["kept-elsewhere"], "personal");
		expect(await sendsFor("team")).toBe(true);
		expect(await sendsFor("personal")).toBe(true);
		expect(await sendsFor("kept-elsewhere")).toBe(false);
	});

	test("a Device sends only for its own personal Space", async () => {
		const sendsFor = facts(false, ["personal-on-host"], "personal");
		expect(await sendsFor("personal")).toBe(true);
		expect(await sendsFor("personal-on-host")).toBe(false);
		expect(await sendsFor("team")).toBe(false);
	});
});
