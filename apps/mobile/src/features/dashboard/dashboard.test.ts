/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DashboardSummary } from "@nightshift/client";

import { healthOf, hiddenText, offlineAlert, offlineText } from "./health";

type Nights = DashboardSummary["nights"][number];
type FlowHealth = NonNullable<DashboardSummary["flowHealth"]>;

const cost = (costUsd: number, costMissing = 0) => ({
	costUsd,
	costEstimated: false,
	costMissing,
});

const noTotals: Nights["totals"] = {
	runs: 0,
	ended: 0,
	finished: 0,
	costUsd: 0,
	gates: 0,
	perNight: [],
};

function nights(
	range: Nights["nights"],
	groups: Nights["runs"]["groups"],
): Nights {
	return {
		nights: range,
		spend: {
			total: 0,
			runs: 0,
			nightsWithRuns: 0,
			unknown: 0,
			groups: [],
			perNight: [],
			priciest: [],
		},
		runs: {
			runs: 0,
			ended: 0,
			finished: 0,
			nightsWithRuns: 0,
			statuses: [],
			perNight: [],
			groups,
			failed: { rows: [], count: 0 },
		},
		gates: {
			asked: 0,
			runsAsking: 0,
			answered: 0,
			unanswered: 0,
			answerTime: null,
			states: [],
			perNight: [],
			groups: { rows: [], count: 0 },
			latest: [],
		},
		totals: noTotals,
		before: noTotals,
		flows: null,
	};
}

function summary(over: Partial<DashboardSummary> = {}): DashboardSummary {
	return {
		at: 0,
		cards: {
			running: 0,
			sleeping: 0,
			nextWakeAt: null,
			lastDay: {
				runs: 0,
				finished: 0,
				failed: 0,
				cost: cost(0),
				latestAt: null,
			},
			dayBefore: { runs: 0, finished: 0, failed: 0, cost: cost(0) },
			yesterday: { running: 0, gates: 0 },
			allTime: cost(0),
			hours: [],
		},
		recent: [],
		open: { rows: [], count: 0, running: 0, nextWakeAt: null },
		activity: [],
		nights: [],
		healthNights: 30,
		lastNight: null,
		upNext: [],
		flowHealth: null,
		...over,
	};
}

describe("healthOf", () => {
	test("lists the runs per project over every Space, with the server's labels", () => {
		const health = healthOf(
			summary({
				nights: [
					nights(7, { rows: [], count: 0 }),
					nights(30, {
						rows: [
							{ label: "nightshift", runs: 4, finished: 3, failed: 1 },
							{ label: "zac", runs: 3, finished: 0, failed: 3 },
						],
						count: 7,
					}),
				],
			}),
		);
		expect(health?.title).toBe("Runs per project");
		expect(health?.hidden).toBe(5);
		expect(health?.rows).toEqual([
			{
				key: "nightshift",
				label: "nightshift",
				mono: false,
				share: 75,
				detail: "3 of 4 finished · 1 failed",
				more: null,
				offline: null,
				last: null,
			},
			{
				key: "zac",
				label: "zac",
				mono: false,
				share: 0,
				detail: "0 of 3 finished · 3 failed",
				more: null,
				offline: null,
				last: null,
			},
		]);
	});

	test("uses the flow health of one project when the server sends it", () => {
		const row: FlowHealth["rows"][number] = {
			name: "nightly",
			last: { runId: "r1", status: "failed", startedAt: 9 },
			lastRuns: [{ runId: "r1", status: "failed", startedAt: 9 }],
			runs: 4,
			finished: 2,
			ended: 3,
			rate: 67,
			cost: null,
			unfinished: { count: 1, costUsd: 0 },
			unknownCost: 0,
			freeRuns: 0,
		};
		const fresh = {
			...row,
			name: "fresh",
			last: null,
			rate: null,
			unfinished: { count: 0, costUsd: 0 },
		};
		const priced = {
			...row,
			name: "priced",
			cost: { min: 0.1, q1: 0.2, median: 0.4, q3: 0.5, max: 0.9, count: 2 },
		};
		const health = healthOf(
			summary({ flowHealth: { rows: [row, fresh, priced], count: 3 } }),
		);
		expect(health?.title).toBe("Flow health");
		expect(health?.rows).toEqual([
			{
				key: "nightly",
				label: "nightly",
				mono: true,
				share: 67,
				detail: "2 of 3 finished",
				more: "1 did not finish",
				offline: null,
				last: { runId: "r1", status: "failed", startedAt: 9 },
			},
			{
				key: "fresh",
				label: "fresh",
				mono: true,
				share: null,
				detail: "No run ended yet",
				more: null,
				offline: null,
				last: null,
			},
			{
				key: "priced",
				label: "priced",
				mono: true,
				share: 67,
				detail: "2 of 3 finished",
				more: "Typical cost $0.40 · 1 did not finish",
				offline: null,
				last: { runId: "r1", status: "failed", startedAt: 9 },
			},
		]);
		expect(health?.hidden).toBe(0);
	});

	test("covers the nights the Host says, in its words and its range", () => {
		const groups = {
			rows: [{ label: "nightshift", runs: 2, finished: 2, failed: 0 }],
			count: 1,
		};
		const health = healthOf(
			summary({
				healthNights: 90,
				nights: [nights(30, { rows: [], count: 0 }), nights(90, groups)],
			}),
		);
		expect(health?.description).toContain("of the last 90 nights");
		expect(health?.rows.map((row) => row.key)).toEqual(["nightshift"]);
		const flows = healthOf(
			summary({ healthNights: 7, flowHealth: { rows: [], count: 1 } }),
		);
		expect(flows?.description).toContain("of the last 7 nights");
	});

	test("an older Host, which does not say the window, counted over 30 nights", () => {
		const { healthNights: _, ...older } = summary({
			nights: [
				nights(30, {
					rows: [{ label: "zac", runs: 1, finished: 1, failed: 0 }],
					count: 1,
				}),
			],
		});
		const health = healthOf(older as DashboardSummary);
		expect(health?.description).toContain("of the last 30 nights");
		expect(health?.rows.map((row) => row.key)).toEqual(["zac"]);
	});

	test("has nothing to show without runs", () => {
		expect(healthOf(summary())).toBeNull();
		expect(
			healthOf(summary({ nights: [nights(30, { rows: [], count: 0 })] })),
		).toBeNull();
		expect(
			healthOf(summary({ flowHealth: { rows: [], count: 0 } })),
		).toBeNull();
	});

	test("says how many rows the server left out", () => {
		expect(hiddenText(0)).toBeNull();
		expect(hiddenText(1)).toBe("1 more is not shown.");
		expect(hiddenText(4)).toBe("4 more are not shown.");
	});

	test("says which flow waits for a computer that is offline", () => {
		const row: FlowHealth["rows"][number] = {
			name: "nightly",
			last: null,
			lastRuns: [],
			runs: 1,
			finished: 1,
			ended: 1,
			rate: 100,
			cost: null,
			unfinished: { count: 0, costUsd: 0 },
			unknownCost: 0,
			freeRuns: 0,
		};
		const health = healthOf(
			summary({
				flowHealth: { rows: [row, { ...row, name: "docs" }], count: 2 },
			}),
			new Map([["nightly", ["Mac mini"]]]),
		);
		expect(health?.rows.map((r) => r.offline)).toEqual([
			"Mac mini is offline. Its steps wait until it is back.",
			null,
		]);
	});
});

describe("offline computers", () => {
	test("names the computers in a sentence", () => {
		expect(offlineText([])).toBeNull();
		expect(offlineText(["A", "B", "C"])).toBe(
			"A, B and C are offline. Their steps wait until they are back.",
		);
	});

	test("sums up the flows that need them", () => {
		expect(offlineAlert(new Map())).toBeNull();
		expect(offlineAlert(new Map([["nightly", ["Mac mini"]]]))).toEqual({
			title: "Mac mini is offline",
			description: "1 flow needs it. Those steps wait until it is back.",
		});
		expect(
			offlineAlert(
				new Map([
					["nightly", ["Mac mini"]],
					["docs", ["Mac mini", "Tower"]],
				]),
			),
		).toEqual({
			title: "2 computers are offline",
			description:
				"2 flows need Mac mini and Tower. Those steps wait until they are back.",
		});
	});
});
