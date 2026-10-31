/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DashboardSummary } from "@nightshift/client";

import { consoleGlance } from "./console";

type Nights = DashboardSummary["nights"][number];
type Totals = Nights["totals"];

const totals = (over: Partial<Totals> = {}): Totals => ({
	runs: 0,
	ended: 0,
	finished: 0,
	costUsd: 0,
	gates: 0,
	perNight: [],
	...over,
});

function summaryOf(
	nights: Nights["nights"],
	now: Partial<Totals>,
	before: Partial<Totals>,
): DashboardSummary {
	return {
		nights: [{ nights, totals: totals(now), before: totals(before) }],
	} as unknown as DashboardSummary;
}

describe("consoleGlance", () => {
	test("shows the four numbers of last week and how each moved", () => {
		const glance = consoleGlance(
			summaryOf(
				7,
				{ runs: 9, ended: 8, finished: 6, costUsd: 2.5, gates: 2 },
				{ runs: 6, ended: 6, finished: 6, costUsd: 3, gates: 2 },
			),
		);
		expect(glance).toEqual({
			hint: "Compared with the 7 nights before",
			empty: false,
			tiles: [
				{
					key: "runs",
					label: "Runs",
					value: "9",
					change: "3 more than the nights before",
				},
				{
					key: "finished",
					label: "Finished",
					value: "75%",
					change: "25 points less than the nights before",
				},
				{
					key: "spend",
					label: "Spend",
					value: "$2.50",
					change: "$0.50 less than the nights before",
				},
				{
					key: "gates",
					label: "Gates asked",
					value: "2",
					change: "Same as the nights before",
				},
			],
		});
	});

	test("compares nothing while the nights before had no runs", () => {
		const glance = consoleGlance(summaryOf(7, { runs: 2 }, {}));
		expect(glance?.hint).toBe("Nothing to compare with yet");
		expect(glance?.tiles.map((tile) => tile.change)).toEqual([
			null,
			null,
			null,
			null,
		]);
		expect(glance?.tiles[1]?.value).toBe("—");
		expect(glance?.empty).toBe(false);
	});

	test("is empty without any runs, and null when the Host does not count the nights", () => {
		expect(consoleGlance(summaryOf(7, {}, {}))?.empty).toBe(true);
		expect(consoleGlance(summaryOf(30, { runs: 1 }, {}))).toBeNull();
	});
});
