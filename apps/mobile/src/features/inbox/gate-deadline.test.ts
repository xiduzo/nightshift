/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { formatTime } from "@/shared/format";
import { deadlineText } from "./gate-deadline";

describe("deadlineText", () => {
	const now = new Date(2026, 9, 26, 22, 0).getTime();

	test("says what Night Shift picks, and when", () => {
		const at = new Date(2026, 9, 26, 23, 30).getTime();
		expect(deadlineText({ at, choose: "keep" }, now)).toBe(
			`If nobody answers, Night Shift picks keep at ${formatTime(at)}.`,
		);
	});

	test("names the day when it is not today", () => {
		const at = new Date(2026, 9, 27, 7, 0).getTime();
		expect(deadlineText({ at, choose: "keep" }, now)).toBe(
			`If nobody answers, Night Shift picks keep at ${formatTime(at)} tomorrow.`,
		);
	});
});
