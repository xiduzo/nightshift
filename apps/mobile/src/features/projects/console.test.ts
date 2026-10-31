/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DashboardSummary } from "@nightshift/client";

import { nightsFacts } from "./console";

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
): DashboardSummary {
	return {
		nights: [{ nights, totals: totals(now), before: totals() }],
	} as unknown as DashboardSummary;
}

describe("nightsFacts", () => {
	test("shows the runs, the share that finished and the spend of last week", () => {
		expect(
			nightsFacts(
				summaryOf(7, {
					runs: 9,
					ended: 8,
					finished: 6,
					costUsd: 2.5,
					gates: 2,
				}),
			),
		).toEqual([
			{ key: "runs", label: "Runs", value: "9" },
			{ key: "finished", label: "Finished", value: "75%" },
			{ key: "spend", label: "Spend", value: "$2.50" },
		]);
	});

	test("has no share without an ended run, and is null when the Host does not count the nights", () => {
		expect(nightsFacts(summaryOf(7, {}))?.[1]?.value).toBe("—");
		expect(nightsFacts(summaryOf(30, { runs: 1 }))).toBeNull();
	});
});
