import { describe, expect, test } from "bun:test";

import { DIGEST_CHOICES, digestAtTime, digestShown } from "./digest";

const HOUR = 60 * 60_000;

describe("the last digest in the inbox", () => {
	test("shows for a day after it went out", () => {
		const now = 100 * HOUR;
		expect(digestShown({ to: now - 2 * HOUR }, now)).toBe(true);
		expect(digestShown({ to: now - 24 * HOUR }, now)).toBe(true);
		expect(digestShown({ to: now - 25 * HOUR }, now)).toBe(false);
	});

	test("not when none went out", () => {
		expect(digestShown(null, 0)).toBe(false);
		expect(digestShown(undefined, 0)).toBe(false);
	});
});

describe("when the digest goes out", () => {
	const night = { start: "22:00", end: "07:00" };
	const digest = (when: "off" | "quiet-hours-end" | "time") => ({
		when,
		time: "08:00",
	});

	test("offers every choice once", () => {
		expect(DIGEST_CHOICES.map((choice) => choice.value)).toEqual([
			"quiet-hours-end",
			"time",
			"off",
		]);
	});

	test("goes at its own time when you chose one", () => {
		expect(digestAtTime({ digest: digest("time"), quietHours: night })).toBe(
			true,
		);
	});

	test("goes at its own time when it follows quiet hours and you have none", () => {
		expect(
			digestAtTime({ digest: digest("quiet-hours-end"), quietHours: null }),
		).toBe(true);
		expect(
			digestAtTime({ digest: digest("quiet-hours-end"), quietHours: night }),
		).toBe(false);
	});

	test("has no time when it is off", () => {
		expect(digestAtTime({ digest: digest("off"), quietHours: null })).toBe(
			false,
		);
	});
});
