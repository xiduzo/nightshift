/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
	HOURS,
	isLastPushUrgency,
	pushUrgenciesWith,
} from "./notification-choices";

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
	});

	test("keeps the last level on, as the web does", () => {
		expect(pushUrgenciesWith(["now"], "now", false)).toEqual(["now"]);
		expect(pushUrgenciesWith(["later"], "later", false)).toEqual(["later"]);
	});

	test("knows the last level that is on, so its switch is off limits", () => {
		expect(isLastPushUrgency(["now"], "now")).toBe(true);
		expect(isLastPushUrgency(["now"], "today")).toBe(false);
		expect(isLastPushUrgency(["now", "today"], "now")).toBe(false);
		// A list a Host saved empty leaves every switch free to turn on.
		expect(isLastPushUrgency([], "now")).toBe(false);
	});
});
