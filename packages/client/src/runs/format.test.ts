import { describe, expect, test } from "bun:test";

import {
	agoLabel,
	compactCount,
	costLabel,
	formatCost,
	formatCountdown,
	formatKnownCost,
	stepOutcomeLabel,
	tokensLabel,
	tokensSplit,
} from "./format";

describe("the cost of a run, when it is known", () => {
	test("in dollars, with a plus when a step did not report its cost", () => {
		expect(costLabel({ costUsd: 2.931, costMissing: 0, costCalls: 3 })).toBe(
			"$2.93",
		);
		expect(costLabel({ costUsd: 1.2, costMissing: 1, costCalls: 2 })).toBe(
			"$1.20+",
		);
	});

	test("nothing while no cost is known", () => {
		expect(costLabel({ costUsd: 0, costMissing: 0, costCalls: 0 })).toBeNull();
		expect(costLabel({ costUsd: 0, costMissing: 2, costCalls: 2 })).toBeNull();
	});

	test("a free run that reported its cost costs $0.00", () => {
		expect(costLabel({ costUsd: 0, costMissing: 0, costCalls: 1 })).toBe(
			"$0.00",
		);
	});
});

describe("how long ago, short", () => {
	const now = Date.UTC(2026, 9, 21, 12, 0, 0);
	const minute = 60_000;

	test("says how long ago, in short words", () => {
		expect(agoLabel(now - 20_000, now)).toBe("just now");
		expect(agoLabel(now - 5 * minute, now)).toBe("5 min ago");
		expect(agoLabel(now - 3 * 60 * minute, now)).toBe("3 h ago");
		expect(agoLabel(now - 30 * 60 * minute, now)).toBe("yesterday");
		expect(agoLabel(now - 4 * 24 * 60 * minute, now)).toBe("4 days ago");
	});

	test("gives the date after a week", () => {
		const text = agoLabel(now - 10 * 24 * 60 * minute, now);
		expect(text).not.toContain("ago");
		expect(text).toMatch(/11/);
	});

	test("a time in the future reads as now", () => {
		expect(agoLabel(now + 5 * minute, now)).toBe("just now");
	});
});

describe("one way to write a cost, on every screen", () => {
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

	test("a run row and the dashboard write a run's cost the same way", () => {
		const run = { costUsd: 0.04123, costMissing: 0, costCalls: 2 };
		expect(costLabel(run)).toBe("$0.0412");
		expect(costLabel(run)).toBe(formatKnownCost(run));
	});
});

describe("an outcome in words, on every screen", () => {
	test("each outcome Night Shift names has a word", () => {
		expect(stepOutcomeLabel("pass")).toBe("Pass");
		expect(stepOutcomeLabel("needs-input")).toBe("Needs input");
		expect(stepOutcomeLabel("error")).toBe("Error");
		expect(stepOutcomeLabel("timeout")).toBe("Timed out");
		expect(stepOutcomeLabel("interrupted")).toBe("Interrupted");
	});

	test("an outcome the flow names shows its own name", () => {
		expect(stepOutcomeLabel("approve")).toBe("approve");
		// Not a key of Object.prototype either.
		expect(stepOutcomeLabel("constructor")).toBe("constructor");
	});
});

describe("a countdown", () => {
	test("minutes and seconds, then hours in front", () => {
		expect(formatCountdown(245_000)).toBe("4:05");
		expect(formatCountdown(3_729_000)).toBe("1:02:09");
	});

	test("rounds a part second up, and stops at zero", () => {
		expect(formatCountdown(59_001)).toBe("1:00");
		expect(formatCountdown(-5_000)).toBe("0:00");
	});
});

describe("tokens, short", () => {
	test("a count reads short at every size", () => {
		expect(compactCount(0)).toBe("0");
		expect(compactCount(950)).toBe("950");
		expect(compactCount(1000)).toBe("1K");
		expect(compactCount(12_345)).toBe("12.3K");
		expect(compactCount(123_456)).toBe("123K");
		expect(compactCount(999_499)).toBe("999K");
		expect(compactCount(999_950)).toBe("1M");
		expect(compactCount(1_234_567)).toBe("1.2M");
	});

	test("tokens in and out add up, nothing known is null", () => {
		expect(tokensLabel({ input: 12_000, output: 345 })).toBe("12.3K tokens");
		expect(tokensSplit({ input: 12_000, output: 345 })).toBe("12K in, 345 out");
		expect(tokensLabel({ input: 0, output: 0 })).toBeNull();
		expect(tokensLabel(undefined)).toBeNull();
		expect(tokensSplit(null)).toBeNull();
	});
});
