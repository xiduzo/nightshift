import { describe, expect, test } from "bun:test";

import { PHONE_DELAYS, phoneDelayLabel } from "./phone-delay";

describe("the phone delay", () => {
	test("goes from no delay up to the Host's limit of an hour", () => {
		expect(PHONE_DELAYS[0]).toBe(0);
		expect(PHONE_DELAYS.at(-1)).toBe(60);
	});

	test("every choice has its own words", () => {
		expect(PHONE_DELAYS.map(phoneDelayLabel)).toEqual([
			"No delay",
			"1 minute",
			"3 minutes",
			"5 minutes",
			"10 minutes",
			"15 minutes",
			"30 minutes",
			"1 hour",
		]);
	});
});
