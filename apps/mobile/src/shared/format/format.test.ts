/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { formatCost, formatKnownCost } from "./cost";
import { formatAgo } from "./time";

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const MINUTE = 60_000;

describe("formatAgo", () => {
	test("says how long ago, in short words", () => {
		expect(formatAgo(NOW - 20_000, NOW)).toBe("just now");
		expect(formatAgo(NOW - 5 * MINUTE, NOW)).toBe("5 min ago");
		expect(formatAgo(NOW - 3 * 60 * MINUTE, NOW)).toBe("3 h ago");
		expect(formatAgo(NOW - 30 * 60 * MINUTE, NOW)).toBe("yesterday");
		expect(formatAgo(NOW - 4 * 24 * 60 * MINUTE, NOW)).toBe("4 days ago");
	});

	test("gives the date after a week", () => {
		const text = formatAgo(NOW - 10 * 24 * 60 * MINUTE, NOW);
		expect(text).not.toContain("ago");
		expect(text).toMatch(/11/);
	});

	test("a time in the future reads as now", () => {
		expect(formatAgo(NOW + 5 * MINUTE, NOW)).toBe("just now");
	});
});

describe("formatCost", () => {
	test("shows cents, and more digits below a dollar", () => {
		expect(formatCost(2.931)).toBe("$2.93");
		expect(formatCost(0.04123)).toBe("$0.0412");
		expect(formatCost(0)).toBe("$0.00");
		expect(formatCost(null)).toBe("—");
	});

	test("marks a cost that is partly not known", () => {
		expect(formatKnownCost({ costUsd: 2.5 })).toBe("$2.50");
		expect(formatKnownCost({ costUsd: 2.5, costMissing: 1 })).toBe("$2.50+");
		expect(formatKnownCost({ costUsd: 0, costMissing: 2 })).toBe("—");
	});
});
