import { describe, expect, test } from "bun:test";

import { consoleValues, daysOf } from "./console";
import type { DashboardSummary, NightsRange } from "./types";

const totals = (
	over: Partial<NightsRange["totals"]> = {},
): NightsRange["totals"] => ({
	runs: 0,
	ended: 0,
	finished: 0,
	costUsd: 0,
	tokens: 0,
	gates: 0,
	neededYou: 0,
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

describe("consoleValues", () => {
	test("counts runs, the share that finished, spend and the share that needed you, now and before", () => {
		const days = range(
			7,
			{ runs: 10, ended: 8, finished: 6, costUsd: 1.5, neededYou: 3 },
			{ runs: 4, ended: 4, finished: 4, costUsd: 2, neededYou: 0 },
		);
		expect(consoleValues(days.totals)).toEqual({
			runs: 10,
			finished: 75,
			spend: 1.5,
			needed: 30,
		});
		expect(consoleValues(days.before)).toEqual({
			runs: 4,
			finished: 100,
			spend: 2,
			needed: 0,
		});
	});

	test("has no share that needed you without runs, or from an older Host", () => {
		expect(consoleValues(range(7, {}, {}).totals).needed).toBeNull();
		const older = range(7, { runs: 5, neededYou: undefined }, {});
		expect(consoleValues(older.totals).needed).toBeNull();
	});

	test("has no share that finished without ended runs", () => {
		expect(consoleValues(range(7, { runs: 2 }, {}).totals).finished).toBeNull();
	});
});

describe("daysOf", () => {
	test("picks the range, and says when the server has none", () => {
		const summary = {
			nights: [range(7, {}, {}), range(30, { runs: 5 }, {})],
		} as unknown as DashboardSummary;
		expect(daysOf(summary, 30).totals.runs).toBe(5);
		expect(() => daysOf(summary, 90)).toThrow("no range of 90 days");
	});
});
