import { describe, expect, test } from "bun:test";

import {
	atLocal,
	dayStart,
	HOUR_MS,
	iso,
	isTimeZone,
	lastDays,
	lastHours,
	nextClockTime,
	parseInstant,
	utc,
	wall,
} from "./clock";

describe("a day runs from midnight to midnight on the reader's clock", () => {
	test("a run at 23:00 and one at 01:00 belong to two days", () => {
		// 23:00 on 14 July and 01:00 on 15 July in Amsterdam, summer time (UTC+2).
		const late = parseInstant("2026-07-14T21:00:00Z");
		const early = parseInstant("2026-07-14T23:00:00Z");
		expect(iso(dayStart(late, "Europe/Amsterdam"))).toBe(
			"2026-07-13T22:00:00.000Z",
		);
		expect(iso(dayStart(early, "Europe/Amsterdam"))).toBe(
			"2026-07-14T22:00:00.000Z",
		);
	});

	test("midnight itself starts a new day", () => {
		const midnight = parseInstant("2026-07-14T00:00:00Z");
		expect(iso(dayStart(midnight, "UTC"))).toBe("2026-07-14T00:00:00.000Z");
		expect(iso(dayStart(midnight - 1, "UTC"))).toBe("2026-07-13T00:00:00.000Z");
	});

	test("the same moment is another day in another time zone", () => {
		// 20:00 UTC is still 10 January in London, already 11 January in Tokyo.
		const at = parseInstant("2026-01-10T20:00:00Z");
		expect(iso(dayStart(at, "Europe/London"))).toBe("2026-01-10T00:00:00.000Z");
		expect(iso(dayStart(at, "Asia/Tokyo"))).toBe("2026-01-10T15:00:00.000Z");
	});

	test("the last days end with today, oldest first, and reach back over a month end", () => {
		const now = parseInstant("2026-03-02T13:00:00Z");
		expect(lastDays(3, now, "UTC").map(iso)).toEqual([
			"2026-02-28T00:00:00.000Z",
			"2026-03-01T00:00:00.000Z",
			"2026-03-02T00:00:00.000Z",
		]);
	});

	test("in Amsterdam, the day summer time starts lasts 23 hours", () => {
		// The clocks go from 02:00 to 03:00 on 29 March 2026.
		const now = parseInstant("2026-03-30T08:00:00Z");
		const days = lastDays(3, now, "Europe/Amsterdam");
		expect(days.map(iso)).toEqual([
			"2026-03-27T23:00:00.000Z",
			"2026-03-28T23:00:00.000Z",
			"2026-03-29T22:00:00.000Z",
		]);
		expect((days[2] ?? 0) - (days[1] ?? 0)).toBe(23 * HOUR_MS);
	});

	test("in Amsterdam, the day summer time ends lasts 25 hours", () => {
		// The clocks go from 03:00 back to 02:00 on 25 October 2026.
		const now = parseInstant("2026-10-26T08:00:00Z");
		const days = lastDays(3, now, "Europe/Amsterdam");
		expect(days.map(iso)).toEqual([
			"2026-10-23T22:00:00.000Z",
			"2026-10-24T22:00:00.000Z",
			"2026-10-25T23:00:00.000Z",
		]);
		expect((days[2] ?? 0) - (days[1] ?? 0)).toBe(25 * HOUR_MS);
		// 02:30 comes twice that night. Both are on 25 October.
		const first = parseInstant("2026-10-25T00:30:00Z");
		const second = parseInstant("2026-10-25T01:30:00Z");
		expect(dayStart(first, "Europe/Amsterdam")).toBe(days[1] ?? 0);
		expect(dayStart(second, "Europe/Amsterdam")).toBe(days[1] ?? 0);
	});

	test("in Kolkata, half an hour off UTC, a day starts at 18:30 UTC", () => {
		const now = parseInstant("2026-05-01T18:29:59Z");
		expect(lastDays(2, now, "Asia/Kolkata").map(iso)).toEqual([
			"2026-04-29T18:30:00.000Z",
			"2026-04-30T18:30:00.000Z",
		]);
		expect(iso(dayStart(now + 1000, "Asia/Kolkata"))).toBe(
			"2026-05-01T18:30:00.000Z",
		);
	});

	test("on the Chatham Islands, 45 minutes off the hour, a day starts at the quarter", () => {
		// Summer time starts on 27 September 2026: 02:45 becomes 03:45, UTC+13:45.
		const now = parseInstant("2026-09-28T00:00:00Z");
		const days = lastDays(3, now, "Pacific/Chatham");
		expect(days.map(iso)).toEqual([
			"2026-09-25T11:15:00.000Z",
			"2026-09-26T11:15:00.000Z",
			"2026-09-27T10:15:00.000Z",
		]);
		expect((days[2] ?? 0) - (days[1] ?? 0)).toBe(23 * HOUR_MS);
	});

	test("where a clock change skips midnight, the day starts at 01:00", () => {
		// Santiago skips from 00:00 to 01:00 on 6 September 2026 (UTC-4 to UTC-3).
		const now = parseInstant("2026-09-07T12:00:00Z");
		expect(lastDays(3, now, "America/Santiago").map(iso)).toEqual([
			"2026-09-05T04:00:00.000Z",
			"2026-09-06T04:00:00.000Z",
			"2026-09-07T03:00:00.000Z",
		]);
	});
});

describe("hours start on the reader's clock", () => {
	test("in a time zone half an hour off UTC, an hour starts at half past", () => {
		const now = parseInstant("2026-05-01T10:50:12.345Z");
		// Kolkata is UTC+5:30: 16:20 there, so this hour began at 10:30 UTC.
		const hours = lastHours(3, now, "Asia/Kolkata");
		expect(hours.map(iso)).toEqual([
			"2026-05-01T08:30:00.000Z",
			"2026-05-01T09:30:00.000Z",
			"2026-05-01T10:30:00.000Z",
		]);
		expect((hours[1] ?? 0) - (hours[0] ?? 0)).toBe(HOUR_MS);
	});

	test("the seconds follow the zone, including an old offset of seconds", () => {
		// Paris in 1891 is 9 minutes and 21 seconds ahead of UTC.
		const at = parseInstant("1891-06-01T00:00:40Z");
		expect(wall(at, "Europe/Paris")).toMatchObject({
			hour: 0,
			minute: 10,
			second: 1,
		});
	});

	test("a time zone this runtime does not know is refused", () => {
		expect(isTimeZone("Europe/Amsterdam")).toBe(true);
		expect(isTimeZone("UTC")).toBe(true);
		expect(isTimeZone("Nowhere/Atlantis")).toBe(false);
	});
});

describe("utc and atLocal", () => {
	test("the next clock time is later today, or the next day once it has passed", () => {
		// 07:12 in Amsterdam on 31 Oct 2026 (CET, UTC+1).
		const at = parseInstant("2026-10-31T06:12:00Z");
		expect(iso(nextClockTime(at, 22, 0, "Europe/Amsterdam"))).toBe(
			"2026-10-31T21:00:00.000Z",
		);
		expect(iso(nextClockTime(at, 7, 0, "Europe/Amsterdam"))).toBe(
			"2026-11-01T06:00:00.000Z",
		);
		expect(iso(nextClockTime(at, 7, 12, "Europe/Amsterdam"))).toBe(
			"2026-11-01T06:12:00.000Z",
		);
	});

	test("utc matches an ISO instant, and atLocal in UTC matches it", () => {
		expect(iso(utc(2026, 9, 31, 7, 12))).toBe("2026-10-31T07:12:00.000Z");
		expect(atLocal(2026, 9, 31, 7, 12, 0, 0, "UTC")).toBe(
			utc(2026, 9, 31, 7, 12),
		);
	});
});
