import { describe, expect, test } from "bun:test";

import {
	BrowserPushProblem,
	browserPushErrorText,
	homeScreenNeeded,
} from "./browser";

const iPhone =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const mac =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("homeScreenNeeded", () => {
	test("an iPhone in a browser tab needs the Home Screen", () => {
		expect(
			homeScreenNeeded({
				userAgent: iPhone,
				platform: "iPhone",
				maxTouchPoints: 5,
				standalone: false,
			}),
		).toBe(true);
	});

	test("an iPad that asks for the desktop site needs it too", () => {
		expect(
			homeScreenNeeded({
				userAgent: mac,
				platform: "MacIntel",
				maxTouchPoints: 5,
				standalone: false,
			}),
		).toBe(true);
	});

	test("Night Shift opened from the Home Screen does not", () => {
		expect(
			homeScreenNeeded({
				userAgent: iPhone,
				platform: "iPhone",
				maxTouchPoints: 5,
				standalone: true,
			}),
		).toBe(false);
	});

	test("a Mac does not", () => {
		expect(
			homeScreenNeeded({
				userAgent: mac,
				platform: "MacIntel",
				maxTouchPoints: 0,
				standalone: false,
			}),
		).toBe(false);
	});
});

describe("browserPushErrorText", () => {
	test("a reason Night Shift wrote shows as it is", () => {
		expect(
			browserPushErrorText(new BrowserPushProblem("Not set up."), true),
		).toBe("Not set up.");
	});

	test("a browser's own error gets fixed words", () => {
		const raw = new DOMException("Registration failed - push service error");
		expect(browserPushErrorText(raw, true)).toBe(
			"Notifications in this browser did not turn on. Try again, or check the notification settings of this browser.",
		);
		expect(browserPushErrorText(raw, false)).toBe(
			"Notifications in this browser did not turn off. Try again.",
		);
	});
});
