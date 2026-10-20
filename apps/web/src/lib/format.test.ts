import { describe, expect, test } from "bun:test";

import { formatDuration } from "./format";

describe("formatDuration", () => {
	test("drops the seconds from an hour on", () => {
		expect(formatDuration(42_000)).toBe("42s");
		expect(formatDuration(185_000)).toBe("3m 05s");
		expect(formatDuration(3_727_000)).toBe("1h 02m");
	});

	test("keeps the seconds of an hour or more when exact", () => {
		expect(formatDuration(3_727_000, true)).toBe("1h 02m 07s");
		expect(formatDuration(185_000, true)).toBe("3m 05s");
	});
});
