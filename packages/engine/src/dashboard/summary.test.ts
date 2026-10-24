import { describe, expect, test } from "bun:test";

import type { RunSummary } from "../read";
import { summarizeFlow } from "./flow-health";
import { projectDashboard, spacesDashboard } from "./spaces";
import { type DashboardScope, summarizeDashboard } from "./summary";

/**
 * The dashboard's numbers, from runs built for each test. The clock is UTC
 * and stands at 15:00, so tonight started three hours ago.
 */

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-21T15:00:00Z");
const TONIGHT = Date.parse("2026-10-21T12:00:00Z");
const NIGHT = 24 * HOUR;

let next = 0;

function aRun(fields: Partial<RunSummary> = {}): RunSummary {
	next += 1;
	const walker = { id: "device-1", name: "this computer", thisDevice: true };
	return {
		id: `run-${next}`,
		projectId: "p1",
		walker,
		device: walker,
		trigger: { kind: "manual" },
		startedBy: null,
		flowName: "night",
		title: `Run ${next}`,
		worktreePath: "",
		branch: `nightshift/run-${next}`,
		baseRef: "main",
		status: "finished",
		reason: null,
		wakeAt: null,
		signal: null,
		inputs: {},
		stopAt: null,
		stopAfterStep: false,
		createdAt: NOW - HOUR,
		endedAt: null,
		costUsd: 0,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		warnings: [],
		subflows: [],
		gates: [],
		...fields,
	};
}

const project = (flows: string[] = []): DashboardScope => ({
	kind: "project",
	flows,
});
const all = (names: Record<string, string>): DashboardScope => ({
	kind: "all",
	projectNames: new Map(Object.entries(names)),
});

function summarize(runs: RunSummary[], scope: DashboardScope = project()) {
	return summarizeDashboard(runs, { now: NOW, timeZone: "UTC", scope });
}

function nightsOf(summary: ReturnType<typeof summarize>, nights: 7 | 30 | 90) {
	const range = summary.nights.find((r) => r.nights === nights);
	if (!range) throw new Error(`no range of ${nights} nights`);
	return range;
}

describe("the stat cards", () => {
	test("count what runs now, what sleeps, and when the first wakes", () => {
		const summary = summarize([
			aRun({ status: "running" }),
			aRun({ status: "sleeping", wakeAt: NOW + 2 * HOUR }),
			aRun({ status: "sleeping", wakeAt: NOW + HOUR }),
			aRun({ status: "finished", endedAt: NOW - HOUR / 2 }),
		]);
		expect(summary.cards.running).toBe(1);
		expect(summary.cards.sleeping).toBe(2);
		expect(summary.cards.nextWakeAt).toBe(NOW + HOUR);
	});

	test("the last day counts runs, outcomes and a cost that is partly not known", () => {
		const summary = summarize([
			aRun({ status: "finished", costUsd: 1.5, createdAt: NOW - 2 * HOUR }),
			aRun({
				status: "failed",
				costUsd: 0.5,
				costMissing: 1,
				createdAt: NOW - 3 * HOUR,
			}),
			aRun({ status: "stopped", costUsd: 0.25, createdAt: NOW - HOUR }),
			// Older than a day: only in the all-time spend.
			aRun({ status: "finished", costUsd: 4, createdAt: NOW - 30 * HOUR }),
		]);
		expect(summary.cards.lastDay).toEqual({
			runs: 3,
			finished: 1,
			failed: 1,
			cost: { costUsd: 2.25, costEstimated: false, costMissing: 1 },
			latestAt: NOW - HOUR,
		});
		expect(summary.cards.allTime.costUsd).toBe(6.25);
	});

	test("the day before and this time yesterday give the cards something to compare with", () => {
		const summary = summarize([
			aRun({ status: "finished", costUsd: 1, createdAt: NOW - 2 * HOUR }),
			aRun({ status: "failed", costUsd: 2, createdAt: NOW - 25 * HOUR }),
			// At work this time yesterday, with a Gate open.
			aRun({
				status: "finished",
				costUsd: 0.5,
				createdAt: NOW - 26 * HOUR,
				endedAt: NOW - 23 * HOUR,
				gates: [{ openedAt: NOW - 25 * HOUR, closedAt: NOW - 23 * HOUR }],
			}),
			// Older than two days: in neither.
			aRun({ status: "finished", costUsd: 4, createdAt: NOW - 50 * HOUR }),
		]);
		expect(summary.cards.dayBefore).toEqual({
			runs: 2,
			finished: 1,
			failed: 1,
			cost: { costUsd: 2.5, costEstimated: false, costMissing: 0 },
		});
		expect(summary.cards.yesterday).toEqual({ running: 1, gates: 1 });
	});

	test("the bars of the last 24 hours add up to the runs of the last day", () => {
		const runs = [
			aRun({ status: "finished", costUsd: 1, createdAt: NOW - 90 * 60_000 }),
			aRun({ status: "failed", costUsd: 2, createdAt: NOW - 30 * 60_000 }),
			aRun({ status: "running", createdAt: NOW - 10 * 60_000 }),
			// Before the first bar, still in the day: it counts in the first hour.
			aRun({ status: "finished", createdAt: NOW - 24 * HOUR + 60_000 }),
		];
		const { hours } = summarize(runs).cards;
		expect(hours).toHaveLength(24);
		expect(hours.at(-1)?.hour).toBe(NOW);
		const started = hours.reduce(
			(sum, hour) => sum + hour.finished + hour.failed + hour.other,
			0,
		);
		expect(started).toBe(4);
		expect(hours[0]?.finished).toBe(1);
		// 15:00 now is the last bar: the runs of 14:30 and 14:50 are in the one before.
		expect(hours.at(-2)).toMatchObject({ failed: 1, other: 1, costUsd: 2 });
		expect(hours.at(-3)).toMatchObject({ finished: 1, costUsd: 1 });
	});

	test("a run counts as at work in every hour from its start to its end, an open one until now", () => {
		const { hours } = summarize([
			aRun({
				status: "finished",
				createdAt: NOW - 3 * HOUR,
				endedAt: NOW - HOUR - 1,
			}),
			aRun({ status: "running", createdAt: NOW - HOUR / 2 }),
		]).cards;
		expect(hours.slice(-4).map((hour) => hour.active)).toEqual([1, 1, 1, 1]);
		expect(hours.at(-5)?.active).toBe(0);
	});

	test("a Gate waits in every hour until it closes, an open one until now", () => {
		const { hours } = summarize([
			aRun({
				status: "waiting",
				gates: [{ openedAt: NOW - 2 * HOUR, closedAt: null }],
			}),
		]).cards;
		expect(hours.slice(-3).map((hour) => hour.gates)).toEqual([1, 1, 1]);
		expect(hours.at(-4)?.gates).toBe(0);
	});
});

describe("the activity details", () => {
	test("give the peak, the busy hours and the time at work per flow", () => {
		const summary = summarize([
			aRun({
				flowName: "night",
				status: "finished",
				createdAt: NOW - 2 * HOUR,
				endedAt: NOW - HOUR,
			}),
			aRun({ flowName: "night", status: "running", createdAt: NOW - HOUR }),
			aRun({ flowName: null, status: "waiting", createdAt: NOW - HOUR / 2 }),
			// Ended before the week: it does not count.
			aRun({
				flowName: "old",
				status: "finished",
				createdAt: NOW - 200 * HOUR,
				endedAt: NOW - 199 * HOUR,
			}),
		]);
		const day = summary.activity.find((range) => range.hours === 24);
		expect(day?.perHour).toHaveLength(24);
		expect(day?.peak).toBe(3);
		expect(day?.busy).toBe(3);
		expect(day?.started).toBe(3);
		expect(day?.groups.rows.map((group) => group.label)).toEqual([
			"night",
			"Quick runs",
		]);
		expect(day?.groups.rows[0]).toMatchObject({
			runs: 2,
			started: 2,
			atWork: 2 * HOUR,
			longest: HOUR,
		});
		expect(summary.activity.map((range) => range.hours)).toEqual([24, 48, 168]);
	});

	test("list the open runs, the oldest first", () => {
		const summary = summarize([
			aRun({ id: "b", status: "running", createdAt: NOW - HOUR }),
			aRun({
				id: "a",
				status: "sleeping",
				createdAt: NOW - 2 * HOUR,
				wakeAt: NOW + HOUR,
			}),
			aRun({ id: "c", status: "finished" }),
		]);
		expect(summary.open.rows.map((run) => run.id)).toEqual(["a", "b"]);
		expect(summary.open.count).toBe(2);
		expect(summary.open.running).toBe(1);
		expect(summary.open.nextWakeAt).toBe(NOW + HOUR);
	});
});

describe("spend over a night range", () => {
	test("stacks the top four groups per night and folds the rest into one", () => {
		const runs = ["a", "b", "c", "d", "e", "f"].map((flowName, index) =>
			aRun({ flowName, costUsd: 6 - index, createdAt: NOW - HOUR }),
		);
		runs.push(
			aRun({ flowName: "a", costUsd: 1, createdAt: TONIGHT - NIGHT + HOUR }),
		);
		const spend = nightsOf(summarize(runs), 7).spend;
		expect(spend.groups).toEqual([
			{ key: "g0", label: "a", runs: 2, total: 7 },
			{ key: "g1", label: "b", runs: 1, total: 5 },
			{ key: "g2", label: "c", runs: 1, total: 4 },
			{ key: "g3", label: "d", runs: 1, total: 3 },
			{ key: "other", label: "2 more", runs: 2, total: 3 },
		]);
		expect(spend.total).toBe(22);
		expect(spend.runs).toBe(7);
		expect(spend.nightsWithRuns).toBe(2);
		expect(spend.perNight).toHaveLength(7);
		expect(spend.perNight.at(-1)).toEqual({
			night: TONIGHT,
			counts: { g0: 6, g1: 5, g2: 4, g3: 3, other: 3 },
		});
		expect(spend.perNight.at(-2)?.counts.g0).toBe(1);
		expect(spend.priciest.map((run) => run.costUsd)).toEqual([6, 5, 4, 3, 2]);
	});

	test("counts the runs whose cost is not known, and leaves out older nights", () => {
		const spend = nightsOf(
			summarize([
				aRun({ costUsd: 1, costMissing: 2 }),
				aRun({ costUsd: 3, createdAt: TONIGHT - 10 * NIGHT }),
			]),
			7,
		).spend;
		expect(spend.unknown).toBe(1);
		expect(spend.total).toBe(1);
	});

	test("over all projects, groups by project, and a run of a removed project by itself", () => {
		const summary = summarize(
			[
				aRun({ projectId: "p1", costUsd: 2 }),
				aRun({ projectId: "gone", costUsd: 1 }),
			],
			all({ p1: "website" }),
		);
		expect(
			nightsOf(summary, 30).spend.groups.map((group) => group.label),
		).toEqual(["website", "Removed"]);
		expect(summary.flowHealth).toBeNull();
	});
});

describe("the dashboard of Spaces and of one project", () => {
	/** One Space's engine, as the dashboard reads it. */
	function aSpace(runs: RunSummary[], projects: Record<string, string>) {
		return {
			listRuns: async (input?: { projectId?: string }) =>
				runs.filter(
					(run) => !input?.projectId || run.projectId === input.projectId,
				),
			listProjects: async () =>
				Object.entries(projects).map(([id, name]) => ({ id, name })) as never,
			listFlows: async () => [{ name: "night" }, { name: "fix" }] as never,
		};
	}

	test("every Space's runs count, grouped by the project's name", async () => {
		const summary = await spacesDashboard(
			[
				aSpace([aRun({ projectId: "p1", costUsd: 2 })], { p1: "website" }),
				aSpace([aRun({ projectId: "p2", costUsd: 1 })], { p2: "shop" }),
			],
			{ now: NOW, timeZone: "UTC" },
		);
		expect(summary.cards.lastDay.runs).toBe(2);
		expect(
			nightsOf(summary, 30).spend.groups.map((group) => group.label),
		).toEqual(["website", "shop"]);
	});

	test("one project counts its own runs, with its flows", async () => {
		const space = aSpace(
			[aRun({ projectId: "p1" }), aRun({ projectId: "p2" })],
			{ p1: "website", p2: "shop" },
		);
		const summary = await projectDashboard(space, "p1", {
			now: NOW,
			timeZone: "UTC",
		});
		expect(summary.cards.lastDay.runs).toBe(1);
		expect(summary.flowHealth?.rows.map((row) => row.name)).toContain("fix");
	});
});

describe("runs over a night range", () => {
	test("count outcomes per night and per flow, and list the failures newest first", () => {
		const range = nightsOf(
			summarize([
				aRun({ flowName: "night", status: "finished" }),
				aRun({ flowName: "night", status: "failed", createdAt: NOW - HOUR }),
				aRun({
					id: "newest-failure",
					flowName: "fix",
					status: "failed",
					createdAt: NOW - HOUR / 2,
				}),
				aRun({ flowName: "fix", status: "running" }),
			]),
			7,
		).runs;
		expect(range.runs).toBe(4);
		expect(range.ended).toBe(3);
		expect(range.finished).toBe(1);
		expect(range.statuses).toEqual([
			{ status: "running", count: 1 },
			{ status: "finished", count: 1 },
			{ status: "failed", count: 2 },
		]);
		expect(range.perNight.at(-1)?.counts).toEqual({
			running: 1,
			finished: 1,
			failed: 2,
		});
		expect(range.perNight.at(0)?.counts).toEqual({
			running: 0,
			finished: 0,
			failed: 0,
		});
		expect(range.groups.rows).toEqual([
			{ label: "night", runs: 2, finished: 1, failed: 1 },
			{ label: "fix", runs: 2, finished: 0, failed: 1 },
		]);
		expect(range.failed.count).toBe(2);
		expect(range.failed.rows[0]?.id).toBe("newest-failure");
	});
});

describe("Gates over a night range", () => {
	test("tell answered, not answered and waiting Gates apart, and how fast you answered", () => {
		const range = nightsOf(
			summarize([
				aRun({
					status: "finished",
					endedAt: NOW - HOUR,
					gates: [
						{ openedAt: NOW - 3 * HOUR, closedAt: NOW - 2 * HOUR },
						{ openedAt: NOW - 2 * HOUR, closedAt: NOW - 2 * HOUR + 60_000 },
					],
				}),
				// The run stopped while its Gate waited.
				aRun({
					status: "stopped",
					endedAt: NOW - HOUR,
					gates: [{ openedAt: NOW - 90 * 60_000, closedAt: NOW - HOUR }],
				}),
				aRun({
					flowName: "fix",
					status: "waiting",
					gates: [{ openedAt: NOW - HOUR / 2, closedAt: null }],
				}),
			]),
			30,
		).gates;
		expect(range.asked).toBe(4);
		expect(range.runsAsking).toBe(3);
		expect(range.answered).toBe(2);
		expect(range.unanswered).toBe(1);
		expect(range.answerTime?.median).toBe((HOUR + 60_000) / 2);
		expect(range.states).toEqual(["answered", "unanswered", "waiting"]);
		expect(range.perNight.at(-1)?.counts).toEqual({
			answered: 2,
			unanswered: 1,
			waiting: 1,
		});
		expect(range.latest[0]).toMatchObject({
			state: "waiting",
			wait: HOUR / 2,
			group: "fix",
		});
		expect(range.groups.rows[0]).toMatchObject({
			label: "night",
			asked: 3,
			answered: 2,
			unanswered: 1,
			typical: (HOUR + 60_000) / 2,
			longest: HOUR,
		});
	});
});

describe("the project dashboard", () => {
	test("shows the latest night with runs, its newest runs first", () => {
		const summary = summarize([
			aRun({ id: "old", createdAt: TONIGHT - NIGHT, costUsd: 9 }),
			aRun({ id: "late", createdAt: TONIGHT + HOUR, costUsd: 1 }),
			aRun({ id: "later", createdAt: TONIGHT + 2 * HOUR, costUsd: 2 }),
		]);
		expect(summary.lastNight?.night).toBe(TONIGHT);
		expect(summary.lastNight?.runs).toBe(2);
		expect(summary.lastNight?.cost.costUsd).toBe(3);
		expect(summary.lastNight?.latest.map((run) => run.id)).toEqual([
			"later",
			"late",
		]);
		expect(summarize([]).lastNight).toBeNull();
	});

	test("lists the coming wake-ups and stop times, the soonest first", () => {
		const summary = summarize([
			aRun({
				id: "sleeper",
				title: "Sleeper",
				status: "sleeping",
				wakeAt: NOW + 2 * HOUR,
			}),
			aRun({
				id: "worker",
				title: "Worker",
				status: "running",
				stopAt: NOW + HOUR,
			}),
			// Past: not up next.
			aRun({ status: "sleeping", wakeAt: NOW - HOUR }),
		]);
		expect(summary.upNext).toEqual([
			{ kind: "stop", at: NOW + HOUR, runId: "worker", title: "Worker" },
			{ kind: "wake", at: NOW + 2 * HOUR, runId: "sleeper", title: "Sleeper" },
		]);
	});

	test("gives Flow health per flow, the busiest first, subflow runs included", () => {
		const summary = summarize(
			[
				aRun({ flowName: "night", status: "finished", costUsd: 2 }),
				aRun({ flowName: "night", status: "failed", costUsd: 0.5 }),
				aRun({
					flowName: "deploy",
					status: "finished",
					costUsd: 1,
					subflows: [
						{
							flowName: "night",
							status: "finished",
							costUsd: 4,
							costEstimated: false,
							costMissing: 0,
							costCalls: 1,
							startedAt: NOW - HOUR,
							endedAt: NOW - HOUR / 2,
						},
					],
				}),
			],
			project(["deploy", "never", "night"]),
		);
		const rows = summary.flowHealth?.rows ?? [];
		expect(rows.map((row) => row.name)).toEqual(["night", "deploy", "never"]);
		expect(rows[0]).toMatchObject({
			runs: 3,
			finished: 2,
			ended: 3,
			rate: 67,
			unfinished: { count: 1, costUsd: 0.5 },
		});
		expect(rows[0]?.cost?.median).toBe(3);
		expect(rows[2]).toMatchObject({ last: null, runs: 0, rate: null });
		expect(summary.flowHealth?.count).toBe(3);
	});
});

describe("one flow in detail", () => {
	test("gives its cost, its length, why runs did not finish and its warnings", () => {
		const warning = (message: string, at: number) => ({
			kind: "cost-unknown" as const,
			message,
			stepId: "s1",
			nodeId: "agent",
			at,
		});
		const runs = [
			aRun({
				id: "a",
				status: "finished",
				costUsd: 1,
				createdAt: NOW - 3 * HOUR,
				endedAt: NOW - 2 * HOUR,
				warnings: [warning("No cost", NOW - 2 * HOUR)],
			}),
			aRun({
				id: "b",
				status: "finished",
				costUsd: 3,
				createdAt: NOW - 2 * HOUR,
				endedAt: NOW - HOUR,
				warnings: [warning("No cost", NOW - HOUR)],
			}),
			// Asked no agent: left out of what a run costs.
			aRun({ id: "c", status: "finished", costCalls: 0, endedAt: NOW }),
			aRun({ id: "d", status: "failed", reason: "Tests fail", costUsd: 5 }),
			aRun({ id: "e", status: "failed", reason: "Tests fail", costUsd: 0 }),
			aRun({ id: "f", status: "stopped", costUsd: 0.5 }),
			aRun({ id: "g", flowName: "other" }),
		];
		const detail = summarizeFlow("night", runs, {
			now: NOW,
			timeZone: "UTC",
		});
		expect(detail.ranges.map((range) => range.nights)).toEqual([7, 30, 90]);
		const range = detail.ranges[0];
		expect(range).toMatchObject({
			runs: 6,
			asSubflow: 0,
			ended: 6,
			finished: 3,
			unfinished: 3,
			warnings: 2,
			dearest: { costUsd: 5 },
		});
		expect(range?.cost).toMatchObject({ median: 2, count: 2 });
		expect(range?.length?.median).toBe(HOUR);
		expect(range?.spentUnfinished.costUsd).toBe(5.5);
		expect(range?.endedRuns).toHaveLength(6);
		expect(range?.whyUnfinished.rows).toEqual([
			expect.objectContaining({
				reason: "Tests fail",
				status: "failed",
				runs: 2,
			}),
			expect.objectContaining({ reason: null, status: "stopped", runs: 1 }),
		]);
		expect(range?.warningRows.rows).toEqual([
			{
				key: "agent\u0000No cost",
				nodeId: "agent",
				message: "No cost",
				runs: 2,
				last: { runId: "b", at: NOW - HOUR },
			},
		]);
		expect(range?.latest).toHaveLength(5);
		expect(range?.latest[0]?.warnings).toBeNumber();
	});
});
