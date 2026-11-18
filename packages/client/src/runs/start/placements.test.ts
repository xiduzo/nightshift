import { describe, expect, test } from "bun:test";

import { hostOwnerHint } from "./placements";

describe("the words for a Host that another person runs", () => {
	test("name the Host admin and what they offer to this Space", () => {
		expect(
			hostOwnerHint({ thisDevice: true, offers: [], ownerName: "Ada" }),
		).toBe("This Host belongs to Ada. Ada has not offered it to this Space.");
		expect(
			hostOwnerHint({
				thisDevice: true,
				offers: ["builder", "coder"],
				ownerName: "Ada",
			}),
		).toBe(
			"This Host belongs to Ada. Ada offers builder, coder to this Space.",
		);
	});

	test("say another person without a name, and nothing for your own places", () => {
		expect(hostOwnerHint({ thisDevice: true, offers: ["coder"] })).toBe(
			"This Host belongs to another person. It offers coder to this Space.",
		);
		expect(hostOwnerHint({ thisDevice: true })).toBeNull();
		expect(hostOwnerHint({ thisDevice: false, offers: ["coder"] })).toBeNull();
	});
});
