import { describe, expect, test } from "bun:test";

import { HOUR_MS, isTimeZone, lastHours, lastNights, nightOf } from "./clock";

const iso = (epochMs: number) => new Date(epochMs).toISOString();

describe("a night runs from noon to noon on the reader's clock", () => {
	test("a run at 23:00 and one at 01:00 belong to the same night", () => {
		// 23:00 and 01:00 in Amsterdam, summer time (UTC+2).
		const late = Date.parse("2026-07-14T21:00:00Z");
		const early = Date.parse("2026-07-14T23:00:00Z");
		expect(nightOf(late, "Europe/Amsterdam")).toBe(
			nightOf(early, "Europe/Amsterdam"),
		);
		expect(iso(nightOf(late, "Europe/Amsterdam"))).toBe(
			"2026-07-14T10:00:00.000Z",
		);
	});

	test("noon itself starts a new night", () => {
		const noon = Date.parse("2026-07-14T12:00:00Z");
		expect(iso(nightOf(noon, "UTC"))).toBe("2026-07-14T12:00:00.000Z");
		expect(iso(nightOf(noon - 1, "UTC"))).toBe("2026-07-13T12:00:00.000Z");
	});

	test("the same moment is another night in another time zone", () => {
		// 10:00 UTC is before noon in London, after noon in Tokyo.
		const at = Date.parse("2026-01-10T10:00:00Z");
		expect(iso(nightOf(at, "Europe/London"))).toBe("2026-01-09T12:00:00.000Z");
		expect(iso(nightOf(at, "Asia/Tokyo"))).toBe("2026-01-10T03:00:00.000Z");
	});

	test("the last nights end with tonight, oldest first, at noon across a clock change", () => {
		// Amsterdam leaves summer time on 25 October 2026.
		const now = Date.parse("2026-10-27T20:00:00Z");
		const nights = lastNights(4, now, "Europe/Amsterdam").map(iso);
		expect(nights).toEqual([
			"2026-10-24T10:00:00.000Z",
			"2026-10-25T11:00:00.000Z",
			"2026-10-26T11:00:00.000Z",
			"2026-10-27T11:00:00.000Z",
		]);
	});

	test("the last nights reach back over a month end", () => {
		const now = Date.parse("2026-03-02T13:00:00Z");
		expect(lastNights(3, now, "UTC").map(iso)).toEqual([
			"2026-02-28T12:00:00.000Z",
			"2026-03-01T12:00:00.000Z",
			"2026-03-02T12:00:00.000Z",
		]);
	});
});

describe("hours start on the reader's clock", () => {
	test("in a time zone half an hour off UTC, an hour starts at half past", () => {
		const now = Date.parse("2026-05-01T10:50:12.345Z");
		// Kolkata is UTC+5:30: 16:20 there, so this hour began at 10:30 UTC.
		const hours = lastHours(3, now, "Asia/Kolkata");
		expect(hours.map(iso)).toEqual([
			"2026-05-01T08:30:00.000Z",
			"2026-05-01T09:30:00.000Z",
			"2026-05-01T10:30:00.000Z",
		]);
		expect((hours[1] ?? 0) - (hours[0] ?? 0)).toBe(HOUR_MS);
	});

	test("a time zone this runtime does not know is refused", () => {
		expect(isTimeZone("Europe/Amsterdam")).toBe(true);
		expect(isTimeZone("UTC")).toBe(true);
		expect(isTimeZone("Nowhere/Atlantis")).toBe(false);
	});
});
