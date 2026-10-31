import { describe, expect, test } from "bun:test";

import { changeOf, consoleNumbers, nightsOf } from "./console";
import type { DashboardSummary, NightsRange } from "./types";

const totals = (
	over: Partial<NightsRange["totals"]> = {},
): NightsRange["totals"] => ({
	runs: 0,
	ended: 0,
	finished: 0,
	costUsd: 0,
	gates: 0,
	perNight: [],
	...over,
});

const range = (
	nights: NightsRange["nights"],
	now: Partial<NightsRange["totals"]>,
	before: Partial<NightsRange["totals"]>,
) =>
	({
		nights,
		totals: totals(now),
		before: totals(before),
	}) as NightsRange;

describe("consoleNumbers", () => {
	test("counts runs, the share that finished, spend and Gates, now and before", () => {
		const numbers = consoleNumbers(
			range(
				7,
				{ runs: 10, ended: 8, finished: 6, costUsd: 1.5, gates: 3 },
				{ runs: 4, ended: 4, finished: 4, costUsd: 2, gates: 0 },
			),
		);
		expect(numbers).toEqual({
			values: { runs: 10, finished: 75, spend: 1.5, gates: 3 },
			before: { runs: 4, finished: 100, spend: 2, gates: 0 },
			compared: true,
		});
	});

	test("has no share without ended runs, and nothing to compare without runs before", () => {
		const numbers = consoleNumbers(range(7, { runs: 2 }, {}));
		expect(numbers.values.finished).toBeNull();
		expect(numbers.compared).toBe(false);
	});
});

describe("nightsOf", () => {
	test("picks the range, and says when the server has none", () => {
		const summary = {
			nights: [range(7, {}, {}), range(30, { runs: 5 }, {})],
		} as unknown as DashboardSummary;
		expect(nightsOf(summary, 30).totals.runs).toBe(5);
		expect(() => nightsOf(summary, 90)).toThrow("no range of 90 nights");
	});
});

describe("changeOf", () => {
	test("says how a number moved against the nights before", () => {
		expect(changeOf("runs", 12, 9)).toEqual({
			trend: "up",
			text: "3 more than the nights before",
			short: "+3",
		});
		expect(changeOf("finished", 60, 75)).toEqual({
			trend: "down",
			text: "15 points less than the nights before",
			short: "−15 pts",
		});
		expect(changeOf("spend", 1, 1.5).short).toBe("−$0.50");
		expect(changeOf("gates", 2, 2).text).toBe("Same as the nights before");
	});

	test("says when there is nothing to set the number against", () => {
		expect(changeOf("runs", 3, undefined).short).toBe("new");
		expect(changeOf("runs", 3, 0).text).toBe("None in the nights before");
		expect(changeOf("finished", null, 50).short).toBe("—");
		expect(changeOf("finished", 50, null).text).toBe(
			"No runs ended in the nights before",
		);
	});
});
