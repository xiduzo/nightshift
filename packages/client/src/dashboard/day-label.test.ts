import { describe, expect, test } from "bun:test";
import { formatWeekdayDate, formatWeekdayDateYear } from "@nightshift/time";
import { utc } from "@nightshift/time/testing";

import { dayLabel } from "./day-label";

describe("dayLabel", () => {
	test("names today and yesterday, and an older day by its weekday and date", () => {
		const now = utc(2026, 10, 11, 9);
		expect(dayLabel(utc(2026, 10, 11), now, "UTC")).toBe("Today");
		expect(dayLabel(utc(2026, 10, 10), now, "UTC")).toBe("Yesterday");
		const older = utc(2026, 10, 9);
		expect(dayLabel(older, now, "UTC")).toBe(formatWeekdayDate(older, "UTC"));
	});

	test("adds the year to a day of another year", () => {
		const now = utc(2026, 0, 2, 9);
		const old = utc(2025, 11, 30, 23);
		expect(dayLabel(old, now, "UTC")).toBe(formatWeekdayDateYear(old, "UTC"));
		expect(dayLabel(old, now, "UTC")).toContain("2025");
	});

	test("reads the day on the reader's clock", () => {
		// 23:30 UTC on 10 November is already 11 November in Amsterdam.
		const now = utc(2026, 10, 11, 9);
		const late = utc(2026, 10, 10, 23, 30);
		expect(dayLabel(late, now, "UTC")).toBe("Yesterday");
		expect(dayLabel(late, now, "Europe/Amsterdam")).toBe("Today");
	});

	test("finds yesterday across a day of 25 hours", () => {
		// Amsterdam leaves summer time on 25 October 2026. That day began
		// at 22:00 UTC on 24 October and lasted 25 hours.
		const now = utc(2026, 9, 26, 6);
		expect(dayLabel(utc(2026, 9, 24, 22), now, "Europe/Amsterdam")).toBe(
			"Yesterday",
		);
	});

	test("names the noon an older Host sends by its day", () => {
		const now = utc(2026, 10, 11, 9);
		expect(dayLabel(utc(2026, 10, 10, 12), now, "UTC")).toBe("Yesterday");
	});
});
