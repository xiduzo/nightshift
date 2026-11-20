import { describe, expect, test } from "bun:test";
import { USAGE_ON_HOST, usageAllowed } from "./policy";

describe("the usage policy of the Spaces", () => {
	test("usage is allowed when no Space turned it off, and when there is no Space", () => {
		expect(usageAllowed([true, true])).toBe(true);
		expect(usageAllowed([])).toBe(true);
		expect(usageAllowed([true, false])).toBe(false);
	});

	test("a Space a Host keeps says where to change usage", () => {
		expect(USAGE_ON_HOST).toBe(
			"Your Host keeps the settings of this Space. Change usage on your Host.",
		);
	});
});
