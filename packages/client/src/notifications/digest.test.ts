import { describe, expect, test } from "bun:test";

import { digestShown } from "./digest";

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
