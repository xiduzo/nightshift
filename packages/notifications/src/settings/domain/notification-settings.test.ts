import { describe, expect, test } from "bun:test";
import { utc } from "@nightshift/time/testing";
import {
	applyPatch,
	defaultSettings,
	inQuietHours,
	pushesUrgency,
	settingsOfStored,
	switchesChanged,
} from "./notification-settings";

const at = (hour: number, minute = 0) => utc(2026, 9, 21, hour, minute);

describe("quiet hours", () => {
	const night = {
		quietHours: { start: "22:00", end: "07:00" },
		timeZone: "UTC",
	};

	test("a window over midnight holds from its start to its end", () => {
		expect(inQuietHours(night, at(21, 59))).toBe(false);
		expect(inQuietHours(night, at(22, 0))).toBe(true);
		expect(inQuietHours(night, at(3, 0))).toBe(true);
		expect(inQuietHours(night, at(6, 59))).toBe(true);
		expect(inQuietHours(night, at(7, 0))).toBe(false);
	});

	test("a window within one day", () => {
		const lunch = { ...night, quietHours: { start: "12:00", end: "13:30" } };
		expect(inQuietHours(lunch, at(11, 59))).toBe(false);
		expect(inQuietHours(lunch, at(13, 0))).toBe(true);
		expect(inQuietHours(lunch, at(13, 30))).toBe(false);
	});

	test("no window, or one that ends when it starts, is never quiet", () => {
		expect(inQuietHours({ ...night, quietHours: null }, at(23))).toBe(false);
		expect(
			inQuietHours(
				{ ...night, quietHours: { start: "08:00", end: "08:00" } },
				at(8),
			),
		).toBe(false);
	});

	test("count in the person's time zone", () => {
		// 21:00 UTC is 23:00 in Amsterdam in October (summer time).
		const amsterdam = { ...night, timeZone: "Europe/Amsterdam" };
		expect(inQuietHours(amsterdam, at(21))).toBe(true);
		expect(inQuietHours(night, at(21))).toBe(false);
	});
});

describe("the settings", () => {
	test("the defaults", () => {
		expect(defaultSettings("UTC")).toEqual({
			events: {
				gateOpened: true,
				runFinished: true,
				runFailed: true,
				deviceWait: true,
			},
			quietHours: null,
			timeZone: "UTC",
			screens: { web: true, expo: true, desktop: true },
			holdMinutes: 3,
			pushUrgencies: ["now"],
		});
	});

	test("a change keeps what it does not name, and the urgencies once each, in order", () => {
		const next = applyPatch(defaultSettings("UTC"), {
			events: { runFinished: false },
			screens: { expo: false },
			pushUrgencies: ["later", "now", "later"],
		});
		expect(next).toMatchObject({
			events: { gateOpened: true, runFinished: false, runFailed: true },
			quietHours: null,
			screens: { web: true, expo: false, desktop: true },
			pushUrgencies: ["now", "later"],
		});
		expect(pushesUrgency(next, "later")).toBe(true);
		expect(pushesUrgency(next, "today")).toBe(false);
	});

	test("what the store kept: screens and urgencies it cannot read take their defaults", () => {
		const kept = {
			...defaultSettings("UTC"),
			screens: "not json",
			pushUrgencies: ["soon"],
		};
		expect(settingsOfStored(kept, "UTC")).toEqual(defaultSettings("UTC"));
		expect(
			settingsOfStored(
				{ ...kept, screens: { expo: false }, pushUrgencies: null },
				"UTC",
			),
		).toMatchObject({
			screens: { web: true, expo: false, desktop: true },
			pushUrgencies: ["now"],
		});
		expect(
			settingsOfStored({ ...kept, timeZone: "Mars/Olympus" }, "Asia/Tokyo")
				.timeZone,
		).toBe("Asia/Tokyo");
	});

	test("a save of the computer's settings changes its switches only when it names one", () => {
		expect(switchesChanged({})).toBe(false);
		expect(switchesChanged({ notifyRunFinished: false })).toBe(true);
	});
});
