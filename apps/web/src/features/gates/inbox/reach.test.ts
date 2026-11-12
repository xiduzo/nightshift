import { describe, expect, test } from "bun:test";

import { reachText } from "./reach";

describe("how a level reaches you", () => {
	test("says a notification goes out only for the levels you push", () => {
		expect(reachText("now", ["now"])).toBe(
			"Night Shift also sends you a notification.",
		);
		expect(reachText("later", ["now"])).toBe("Only here in the inbox.");
		expect(reachText("now", undefined)).toBeNull();
	});
});
