import { describe, expect, test } from "bun:test";

import { costLabel, whenLabel } from "./format";

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
		expect(costLabel({ costUsd: 0.4231, costMissing: 0, costCalls: 3 })).toBe(
			"$0.42",
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
