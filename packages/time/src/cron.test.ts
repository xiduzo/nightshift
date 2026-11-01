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
});
