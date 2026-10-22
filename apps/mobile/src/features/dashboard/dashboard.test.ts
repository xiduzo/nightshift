/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DashboardSummary, RunSummary } from "@nightshift/client";

import { hasRuns, runFacts, statCards } from "./cards";
import { HEALTH_NIGHTS, healthOf } from "./health";

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

describe("statCards", () => {
	test("shows the four numbers of the web dashboard", () => {
		const cards = statCards(
			summary({
				cards: {
					...summary().cards,
					running: 2,
					lastDay: {
						runs: 5,
						finished: 3,
						failed: 1,
						cost: cost(1.5, 1),
						latestAt: 1,
					},
					allTime: cost(12),
				},
			}),
			1,
		);
		expect(cards.map((card) => [card.label, card.value])).toEqual([
			["Running now", "2"],
			["Waiting for you", "1"],
			["Spent, last 24 h", "$1.50+"],
			["Runs, last 24 h", "5"],
		]);
		const [running, waiting, spent, runs] = cards;
		expect(running?.headline).toBe("Agents are at work");
		expect(waiting).toMatchObject({
			headline: "A Gate needs your answer",
			tone: "waiting",
			opens: "inbox",
		});
		expect(spent).toMatchObject({
			headline: "In 5 runs",
			footer: "All time $12.00",
		});
		expect(runs).toMatchObject({
			headline: "3 finished, 1 failed",
			footer: "1 stopped, running or waiting",
			tone: "failed",
			finishedShare: 60,
		});
	});

	test("reads calm when nothing runs and nothing waits", () => {
		const [running, waiting, , runs] = statCards(summary(), 0);
		expect(running).toMatchObject({
			headline: "Nothing running",
			footer: "Start a flow in the Start tab.",
		});
		expect(waiting).toMatchObject({
			headline: "Nothing needs you",
			tone: "plain",
		});
		expect(runs).toMatchObject({
			footer: "Started in the last day",
			tone: "plain",
			finishedShare: null,
		});
	});

	test("says when the next sleeping run wakes", () => {
		const [running] = statCards(
			summary({
				cards: { ...summary().cards, sleeping: 1, nextWakeAt: Date.now() },
			}),
			0,
		);
		expect(running?.footer).toStartWith("1 run sleeps. The next wakes at ");
	});

	test("shows a dash when the open Gates did not load", () => {
		const [, waiting] = statCards(summary(), null);
		expect(waiting).toMatchObject({
			value: "—",
			headline: "Nothing needs you",
		});
	});
});

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
		expect(health?.more).toBe(5);
		expect(health?.rows).toEqual([
			{
				key: "nightshift",
				label: "nightshift",
				share: 75,
				detail: "3 of 4 finished, 1 failed",
				last: null,
			},
			{
				key: "zac",
				label: "zac",
				share: 0,
				detail: "0 of 3 finished, 3 failed",
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
		const fresh = { ...row, name: "fresh", last: null, rate: null };
		const health = healthOf(
			summary({ flowHealth: { rows: [row, fresh], count: 2 } }),
		);
		expect(health?.title).toBe("Flow health");
		expect(health?.rows).toEqual([
			{
				key: "nightly",
				label: "nightly",
				share: 67,
				detail: "2 of 3 finished",
				last: { status: "failed", startedAt: 9 },
			},
			{
				key: "fresh",
				label: "fresh",
				share: null,
				detail: "No run ended yet",
				last: null,
			},
		]);
	});

	test("has nothing to show without runs", () => {
		expect(healthOf(summary())).toBeNull();
		expect(
			healthOf(summary({ nights: [nights(30, { rows: [], count: 0 })] })),
		).toBeNull();
		expect(
			healthOf(summary({ flowHealth: { rows: [], count: 0 } })),
		).toBeNull();
		expect(hasRuns(summary())).toBe(false);
	});
});

describe("runFacts", () => {
	const NOW = Date.UTC(2026, 9, 21, 12);
	const run = {
		title: "Fix the login",
		flowName: "nightly-check",
		createdAt: NOW - 5 * 60_000,
		costUsd: 0.42,
		costMissing: 0,
		costCalls: 2,
	} as RunSummary;

	test("names the flow, when the run started, and its cost", () => {
		expect(runFacts(run, NOW)).toBe("nightly-check, 5 min ago, $0.42");
	});

	test("leaves the flow out when the title already says it", () => {
		expect(runFacts({ ...run, title: "nightly-check" }, NOW)).toBe(
			"5 min ago, $0.42",
		);
	});

	test("leaves the cost out while it is not known, as the Runs tab does", () => {
		expect(
			runFacts({ ...run, costUsd: 0, costMissing: 0, costCalls: 0 }, NOW),
		).toBe("nightly-check, 5 min ago");
	});

	test("calls a run without a flow a quick run", () => {
		expect(runFacts({ ...run, flowName: null }, NOW)).toBe(
			"Quick run, 5 min ago, $0.42",
		);
	});
});
