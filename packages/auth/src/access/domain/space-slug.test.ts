import { describe, expect, test } from "bun:test";
import { spaceSlug } from "./space-slug";

describe("spaceSlug", () => {
	test("keeps lower case letters, digits and dashes, then the suffix", () => {
		expect(spaceSlug("Platform Team 2", "1a2b3c4d")).toBe(
			"platform-team-2-1a2b3c4d",
		);
		expect(spaceSlug("  Ops & Café!  ", "x")).toBe("ops-cafe-x");
	});

	test("a name without letters or digits is a space", () => {
		expect(spaceSlug("!!!", "x")).toBe("space-x");
	});

	test("takes at most 40 characters of the name", () => {
		expect(spaceSlug("a".repeat(50), "x")).toBe(`${"a".repeat(40)}-x`);
	});
});
