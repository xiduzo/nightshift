import { describe, expect, test } from "bun:test";

import { isPausedTonight } from "./tonight";

describe("isPausedTonight", () => {
	test("is paused until the pause ends", () => {
		expect(isPausedTonight({ pausedUntil: 1_000 }, 999)).toBe(true);
	});

	test("a pause that ended means nothing", () => {
		expect(isPausedTonight({ pausedUntil: 1_000 }, 1_000)).toBe(false);
		expect(isPausedTonight({ pausedUntil: 1_000 }, 5_000)).toBe(false);
	});

	test("a schedule without a pause is not paused", () => {
		expect(isPausedTonight({}, 0)).toBe(false);
	});
});
