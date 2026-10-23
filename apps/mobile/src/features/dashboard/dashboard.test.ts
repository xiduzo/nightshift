/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DashboardSummary } from "@nightshift/client";

import { HEALTH_NIGHTS, healthOf, hiddenText } from "./health";

type Nights = DashboardSummary["nights"][number];
type FlowHealth = NonNullable<DashboardSummary["flowHealth"]>;

const cost = (costUsd: number, costMissing = 0) => ({
	costUsd,
	costEstimated: false,
	costMissing,
});

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
			allTime: cost(0),
			hours: [],
		},
		recent: [],
		open: { rows: [], count: 0, running: 0, nextWakeAt: null },
		activity: [],
		nights: [],
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
					nights(HEALTH_NIGHTS, {
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
				last: null,
			},
			{
				key: "zac",
				label: "zac",
				mono: false,
				share: 0,
				detail: "0 of 3 finished · 3 failed",
				more: null,
				last: null,
			},
		]);
	});

	test("uses the flow health of one project when the server sends it", () => {
		const row: FlowHealth["rows"][number] = {
			name: "nightly",
			last: { runId: "r1", status: "failed", startedAt: 9 },
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
				last: { runId: "r1", status: "failed", startedAt: 9 },
			},
			{
				key: "fresh",
				label: "fresh",
				mono: true,
				share: null,
				detail: "No run ended yet",
				more: null,
				last: null,
			},
			{
				key: "priced",
				label: "priced",
				mono: true,
				share: 67,
				detail: "2 of 3 finished",
				more: "Typical cost $0.40 · 1 did not finish",
				last: { runId: "r1", status: "failed", startedAt: 9 },
			},
		]);
		expect(health?.hidden).toBe(0);
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
});
