import { describe, expect, test } from "bun:test";

import { utc } from "./clock";
import { latestCronTime, nextCronTimes } from "./cron";

describe("cron times", () => {
	test("the next run follows the zone, not UTC", () => {
		const amsterdam = "Europe/Amsterdam";
		expect(
			nextCronTimes("0 22 * * *", utc(2026, 9, 24, 12), 2, amsterdam),
		).toEqual([utc(2026, 9, 24, 20), utc(2026, 9, 25, 21)]);
	});

	test("the latest run is the one at or before the instant", () => {
		expect(
			latestCronTime(
				"0 22 * * *",
				utc(2026, 9, 30, 21, 30),
				"Europe/Amsterdam",
			),
		).toBe(utc(2026, 9, 30, 21));
	});
	// The clock changes follow Vixie cron (croner 11).
	test("a time in the skipped spring hour runs at the start of the next hour", () => {
		expect(
			nextCronTimes("30 2 * * *", utc(2027, 2, 27, 12), 2, "Europe/Amsterdam"),
		).toEqual([utc(2027, 2, 28, 1), utc(2027, 2, 29, 0, 30)]);
	});

	test("an hourly line runs in both copies of the repeated autumn hour", () => {
		expect(
			nextCronTimes(
				"0 * * * *",
				utc(2026, 9, 24, 23, 30),
				3,
				"Europe/Amsterdam",
			),
		).toEqual([utc(2026, 9, 25, 0), utc(2026, 9, 25, 1), utc(2026, 9, 25, 2)]);
	});

	test("a fixed time in the repeated autumn hour runs once", () => {
		expect(
			nextCronTimes("30 2 * * *", utc(2026, 9, 24, 12), 2, "Europe/Amsterdam"),
		).toEqual([utc(2026, 9, 25, 0, 30), utc(2026, 9, 26, 1, 30)]);
	});
});
