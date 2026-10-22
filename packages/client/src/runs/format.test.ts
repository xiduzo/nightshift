import { describe, expect, test } from "bun:test";

import {
	agoLabel,
	costLabel,
	formatCost,
	formatKnownCost,
	whenLabel,
} from "./format";

describe("when a run started, short", () => {
	const now = new Date(2026, 9, 21, 14, 30).getTime();
	const at = (day: number, hours: number, minutes: number) =>
		new Date(2026, 9, day, hours, minutes).getTime();

	test("just now, then minutes ago for the first hour", () => {
		expect(whenLabel(now - 20_000, now)).toBe("Just now");
		expect(whenLabel(now - 12 * 60_000, now)).toBe("12 min ago");
		expect(whenLabel(now - 59 * 60_000, now)).toBe("59 min ago");
	});

	test("today and yesterday with the time", () => {
		expect(whenLabel(at(21, 9, 5), now)).toBe("Today 09:05");
		expect(whenLabel(at(20, 23, 41), now)).toBe("Yesterday 23:41");
	});

	test("an older day with its date and time", () => {
		const label = whenLabel(at(3, 8, 0), now);
		expect(label).toEndWith(" 08:00");
		expect(label).toContain("3");
	});
});

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
