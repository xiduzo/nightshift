/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { HOURS, pushUrgenciesWith } from "./notification-choices";

describe("the choices of Settings", () => {
	test("offers every hour of the day", () => {
		expect(HOURS).toHaveLength(24);
		expect(HOURS[0]).toBe("00:00");
		expect(HOURS[23]).toBe("23:00");
	});
});

describe("Push for", () => {
	test("turns one urgency on or off and keeps the order", () => {
		expect(pushUrgenciesWith(["now"], "later", true)).toEqual(["now", "later"]);
		expect(pushUrgenciesWith(["later", "now"], "today", true)).toEqual([
			"now",
			"today",
			"later",
		]);
		expect(pushUrgenciesWith(["now", "today"], "now", false)).toEqual([
			"today",
		]);
		expect(pushUrgenciesWith(["now"], "now", false)).toEqual([]);
	});
});
