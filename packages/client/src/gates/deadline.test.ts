import { describe, expect, test } from "bun:test";

import { deadlineText, deadlineWhen } from "./deadline";

/** A moment on this machine's clock, in October 2026 (the 29th is a Thursday). */
function at(day: number, hour: number): number {
	return new Date(2026, 9, day, hour, 0).getTime();
}

const NOW = at(29, 22);

function clock(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
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
		const weekday = new Date(at(31, 7)).toLocaleDateString(undefined, {
			weekday: "long",
		});
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
