import { describe, expect, test } from "bun:test";

import { formatTime, formatWeekday } from "@nightshift/time";
import { atLocal } from "@nightshift/time/testing";
import { deadlineSoon, deadlineText, deadlineWhen } from "./deadline";

/** A moment on this machine's clock, in October 2026 (the 29th is a Thursday). */
function at(day: number, hour: number): number {
	return atLocal(2026, 9, day, hour, 0);
}

const NOW = at(29, 22);

function clock(epochMs: number): string {
	return formatTime(epochMs);
}

describe("deadlineWhen", () => {
	test("today adds no day", () => {
		expect(deadlineWhen(at(29, 23), NOW)).toEqual({
			time: clock(at(29, 23)),
			day: "",
		});
	});

	test("the next day is tomorrow", () => {
		expect(deadlineWhen(at(30, 7), NOW).day).toBe(" tomorrow");
	});

	test("a later day goes by its weekday", () => {
		const weekday = formatWeekday(at(31, 7));
		expect(deadlineWhen(at(31, 7), NOW).day).toBe(` on ${weekday}`);
	});

	test("a deadline that has passed adds no day", () => {
		expect(deadlineWhen(at(27, 7), NOW).day).toBe("");
	});
});

describe("deadlineText", () => {
	const deadline = { at: at(30, 7), choose: "keep" };

	test("says what Night Shift picks, and when", () => {
		expect(deadlineText(deadline, NOW)).toBe(
			`If nobody answers, Night Shift picks keep at ${clock(deadline.at)} tomorrow.`,
		);
	});
});

describe("deadlineSoon", () => {
	const deadline = { at: at(30, 7), choose: "keep" };
	const before = (minutes: number) => deadline.at - minutes * 60_000;

	test("says what Night Shift picks, and how soon, in the last hour", () => {
		expect(deadlineSoon(deadline, before(12))).toBe("Picks keep in 12 min");
		expect(deadlineSoon(deadline, before(60))).toBe("Picks keep in 1 h");
		expect(deadlineSoon(deadline, deadline.at - 20_000)).toBe(
			"Picks keep in under a minute",
		);
	});

	test("says nothing further away, after the deadline, or without one", () => {
		expect(deadlineSoon(deadline, before(61))).toBeNull();
		expect(deadlineSoon(deadline, deadline.at)).toBeNull();
		expect(deadlineSoon(null, NOW)).toBeNull();
	});
});

describe("the deadline of an Ask", () => {
	const form = { schema: { type: "object" } };
	test("takes the default, or the step fails without one", () => {
		const at = atLocal(2026, 9, 31, 7, 0);
		const now = atLocal(2026, 9, 31, 6, 50);
		const deadline = { at, choose: "answer" };
		expect(deadlineText(deadline, now, { ...form, default: {} })).toStartWith(
			"If nobody answers, Night Shift takes the default at ",
		);
		expect(deadlineText(deadline, now, form)).toStartWith(
			"If nobody answers, the step fails at ",
		);
		expect(deadlineSoon(deadline, now, { ...form, default: {} })).toBe(
			"Takes the default in 10 min",
		);
	});
});
