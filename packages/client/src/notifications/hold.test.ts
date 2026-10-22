import { describe, expect, test } from "bun:test";

import { HOLD_MINUTES, holdLabel } from "./hold";

describe("the phone delay", () => {
	test("offers every delay from none to an hour, as the Host takes them", () => {
		expect(HOLD_MINUTES[0]).toBe(0);
		expect(HOLD_MINUTES.at(-1)).toBe(60);
	});

	test("says each delay in words", () => {
		expect(HOLD_MINUTES.map(holdLabel)).toEqual([
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
