import { describe, expect, test } from "bun:test";
import { iso, parseInstant } from "@nightshift/time";
import type { RunSummary } from "../read";
import { summarizeFlow } from "./flow-health";
import { projectDashboard, spacesDashboard } from "./spaces";
import { type DashboardScope, summarizeDashboard } from "./summary";

/**
 * The dashboard's numbers, from runs built for each test. The clock is UTC
 * and stands at 15:00, so today started fifteen hours ago.
 */

const HOUR = 60 * 60 * 1000;
const NOW = parseInstant("2026-10-21T15:00:00Z");
const TODAY = parseInstant("2026-10-21T00:00:00Z");
const DAY = 24 * HOUR;

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
		result: null,
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
		sleeps: [],
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

function daysOf(summary: ReturnType<typeof summarize>, days: 7 | 30 | 90) {
	const range = summary.nights.find((r) => r.nights === days);
	if (!range) throw new Error(`no range of ${days} days`);
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
			tokens: 0,
			latestAt: NOW - HOUR,
		});
		expect(summary.cards.allTime.costUsd).toBe(6.25);
	});

	test("the day before and this time yesterday give the cards something to compare with", () => {
		const summary = summarize([
			aRun({ status: "finished", costUsd: 1, createdAt: NOW - 2 * HOUR }),
			aRun({ status: "failed", costUsd: 2, createdAt: NOW - 25 * HOUR }),
			// At work this time yesterday.
			aRun({
				status: "finished",
				costUsd: 0.5,
				createdAt: NOW - 26 * HOUR,
				endedAt: NOW - 23 * HOUR,
			}),
			// Waiting for a person this time yesterday, not at work.
			aRun({
				status: "finished",
				createdAt: NOW - 26 * HOUR,
				endedAt: NOW - 23 * HOUR,
				gates: [
					{
						openedAt: NOW - 25 * HOUR,
						closedAt: NOW - 23 * HOUR,
						answeredBy: null,
					},
				],
			}),
			// Older than two days: in neither.
			aRun({ status: "finished", costUsd: 4, createdAt: NOW - 50 * HOUR }),
		]);
		expect(summary.cards.dayBefore).toEqual({
			runs: 3,
			finished: 2,
			failed: 1,
			cost: { costUsd: 2.5, costEstimated: false, costMissing: 0 },
			tokens: 0,
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

	test("a run that sleeps is not at work in the hours it sleeps", () => {
		const { hours } = summarize([
			aRun({
				status: "sleeping",
				createdAt: NOW - 3 * HOUR,
				sleeps: [{ from: NOW - HOUR - HOUR / 2, to: null }],
			}),
		]).cards;
		expect(hours.slice(-4).map((hour) => hour.active)).toEqual([1, 1, 0, 0]);
	});

	test("a Gate waits in every hour until it closes, an open one until now", () => {
		const { hours } = summarize([
			aRun({
				status: "waiting",
				gates: [{ openedAt: NOW - 2 * HOUR, closedAt: null, answeredBy: null }],
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

	test("leave the time a run slept or waited for a person out of its time at work", () => {
		const summary = summarize([
			aRun({
				status: "finished",
				createdAt: NOW - 4 * HOUR,
				endedAt: NOW,
				gates: [
					{
						openedAt: NOW - 3 * HOUR,
						closedAt: NOW - 2 * HOUR,
						answeredBy: null,
					},
				],
				sleeps: [
					{ from: NOW - 2 * HOUR, to: NOW - HOUR - HOUR / 2 },
					{ from: NOW - HOUR, to: NOW - HOUR / 2 },
				],
			}),
			aRun({
				status: "sleeping",
				createdAt: NOW - HOUR,
				sleeps: [{ from: NOW - HOUR / 2, to: null }],
			}),
		]);
		const day = summary.activity.find((range) => range.hours === 24);
		expect(day?.groups.rows[0]).toMatchObject({
			runs: 2,
			atWork: 2 * HOUR + HOUR / 2,
			longest: 2 * HOUR,
		});
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
		expect(summary.open.nextWakeAt).toBe(NOW + HOUR);
	});

	test("count Running now as the runs at work or asleep, not the ones at a Gate", () => {
		const summary = summarize([
			aRun({ id: "work", status: "running", createdAt: NOW - HOUR }),
			aRun({ id: "sleep", status: "sleeping", createdAt: NOW - HOUR }),
			aRun({ id: "gate", status: "waiting", createdAt: NOW - HOUR }),
			aRun({ id: "done", status: "finished" }),
		]);
		expect(summary.open.count).toBe(3);
		expect(summary.open.running).toBe(2);
	});
});

describe("spend over a range of days", () => {
	test("stacks the top four groups per day and folds the rest into one", () => {
		const runs = ["a", "b", "c", "d", "e", "f"].map((flowName, index) =>
			aRun({ flowName, costUsd: 6 - index, createdAt: NOW - HOUR }),
		);
		runs.push(
			aRun({ flowName: "a", costUsd: 1, createdAt: TODAY - DAY + HOUR }),
		);
		const spend = daysOf(summarize(runs), 7).spend;
		expect(spend.groups).toEqual([
			{
				key: "g0",
				label: "a",
				runs: 2,
				total: 7,
				unfinished: 0,
				tokens: 0,
				unfinishedTokens: 0,
			},
			{
				key: "g1",
				label: "b",
				runs: 1,
				total: 5,
				unfinished: 0,
				tokens: 0,
				unfinishedTokens: 0,
			},
			{
				key: "g2",
				label: "c",
				runs: 1,
				total: 4,
				unfinished: 0,
				tokens: 0,
				unfinishedTokens: 0,
			},
			{
				key: "g3",
				label: "d",
				runs: 1,
				total: 3,
				unfinished: 0,
				tokens: 0,
				unfinishedTokens: 0,
			},
			{
				key: "other",
				label: "2 more",
				runs: 2,
				total: 3,
				unfinished: 0,
				tokens: 0,
				unfinishedTokens: 0,
			},
		]);
		expect(spend.total).toBe(22);
		expect(spend.runs).toBe(7);
		expect(spend.nightsWithRuns).toBe(2);
		expect(spend.perNight).toHaveLength(7);
		expect(spend.perNight.at(-1)).toEqual({
			night: TODAY,
			counts: { g0: 6, g1: 5, g2: 4, g3: 3, other: 3 },
		});
		expect(spend.perNight.at(-2)?.counts.g0).toBe(1);
		expect(spend.priciest.map((run) => run.costUsd)).toEqual([6, 5, 4, 3, 2]);
	});

	test("adds the tokens a run reported to the spend and the day totals", () => {
		const range = daysOf(
			summarize([
				aRun({
					costUsd: 1.2,
					metrics: {
						wallMs: 1,
						agentMs: 1,
						gateWaitMs: 0,
						tokens: { input: 12_000, output: 345, cacheRead: 0, cacheWrite: 0 },
						costBasis: "billed",
						prUrl: null,
					},
				}),
				aRun({ costUsd: 0.3 }),
			]),
			7,
		);
		expect(range.spend.tokens).toBe(12_345);
		expect(range.spend.groups[0]?.tokens).toBe(12_345);
		expect(range.totals.tokens).toBe(12_345);
		expect(range.totals.perNight.at(-1)?.tokens).toBe(12_345);
	});

	test("counts the runs whose cost is not known, and leaves out older days", () => {
		const spend = daysOf(
			summarize([
				aRun({ costUsd: 1, costMissing: 2 }),
				aRun({ costUsd: 3, createdAt: TODAY - 10 * DAY }),
			]),
			7,
		).spend;
		expect(spend.unknown).toBe(1);
		expect(spend.total).toBe(1);
	});

	test("tells what the runs that did not finish spent", () => {
		const spend = daysOf(
			summarize([
				aRun({ status: "finished", costUsd: 4 }),
				aRun({ status: "failed", costUsd: 2 }),
				aRun({ status: "stopped", costUsd: 1 }),
				aRun({ status: "running", costUsd: 8 }),
			]),
			7,
		).spend;
		expect(spend.groups[0]).toMatchObject({ total: 15, unfinished: 3 });
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
			daysOf(summary, 30).spend.groups.map((group) => group.label),
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
			flows: {
				list: async () => [{ name: "night" }, { name: "fix" }] as never,
			},
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
			daysOf(summary, 30).spend.groups.map((group) => group.label),
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

	test("a flow's row says how steady its cost and its time are", () => {
		const finished = (costUsd: number, minutes: number) =>
			aRun({
				status: "finished",
				createdAt: NOW - 2 * HOUR,
				endedAt: NOW - 2 * HOUR + minutes * 60_000,
				costUsd,
			});
		const row = summarize(
			[finished(1, 10), finished(1, 10), finished(1, 10), finished(1.1, 50)],
			project(["night"]),
		).flowHealth?.rows.find((flow) => flow.name === "night");
		expect(row?.steady).toEqual({ cost: "steady", time: "unsteady" });
	});

	test("says the days Flow health covers: one of its ranges of days", async () => {
		const space = aSpace([aRun({ projectId: "p1" })], { p1: "website" });
		const read = { now: NOW, timeZone: "UTC" };
		for (const summary of [
			await projectDashboard(space, "p1", read),
			await spacesDashboard([space], read),
		]) {
			expect(summary.healthNights).toBe(30);
			expect(summary.nights.map((range) => range.nights)).toContain(
				summary.healthNights,
			);
		}
	});
});

describe("runs over a range of days", () => {
	test("count outcomes per day and per flow, and list the failures newest first", () => {
		const range = daysOf(
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

	test("tell how the flow did after each failure", () => {
		const range = daysOf(
			summarize([
				aRun({
					id: "early",
					flowName: "night",
					status: "failed",
					createdAt: NOW - 3 * HOUR,
				}),
				aRun({
					flowName: "night",
					status: "failed",
					createdAt: NOW - 2 * HOUR,
				}),
				aRun({ flowName: "night", status: "finished", createdAt: NOW - HOUR }),
				aRun({ flowName: "fix", status: "finished", createdAt: NOW }),
			]),
			7,
		).runs;
		expect(range.failed.rows.map((run) => run.after)).toEqual([
			{
				runs: 1,
				finished: 1,
				last: { status: "finished", createdAt: NOW - HOUR },
			},
			{
				runs: 2,
				finished: 1,
				last: { status: "finished", createdAt: NOW - HOUR },
			},
		]);
		expect(range.failed.rows[1]?.id).toBe("early");
	});
});

describe("the totals of a range of days", () => {
	test("count runs, outcomes, spend and Gates, and the same days just before", () => {
		const summary = summarize([
			aRun({
				status: "finished",
				costUsd: 2,
				createdAt: TODAY + HOUR,
				gates: [
					{
						openedAt: TODAY + HOUR,
						closedAt: TODAY + 2 * HOUR,
						answeredBy: null,
					},
				],
			}),
			aRun({
				status: "failed",
				costUsd: 1,
				createdAt: TODAY - 3 * DAY,
				neededYou: [{ reason: "resumed", at: TODAY - 2 * DAY }],
			}),
			// Stopped: a run, not one that ended for the finished share.
			aRun({ status: "stopped", createdAt: TODAY - 6 * DAY }),
			// The 7 days before.
			aRun({ status: "finished", costUsd: 4, createdAt: TODAY - 8 * DAY }),
			aRun({ status: "failed", createdAt: TODAY - 13 * DAY }),
			// Older than both: in neither.
			aRun({ status: "finished", costUsd: 9, createdAt: TODAY - 14 * DAY }),
		]);
		const { totals, before } = daysOf(summary, 7);
		expect(totals).toMatchObject({
			runs: 3,
			ended: 2,
			finished: 1,
			costUsd: 3,
			tokens: 0,
			gates: 1,
			neededYou: 1,
		});
		expect(totals.perNight).toHaveLength(7);
		expect(totals.perNight.at(-1)).toEqual({
			night: TODAY,
			runs: 1,
			ended: 1,
			finished: 1,
			costUsd: 2,
			tokens: 0,
			gates: 1,
			neededYou: 0,
		});
		expect(before).toMatchObject({
			runs: 2,
			ended: 2,
			finished: 1,
			costUsd: 4,
			tokens: 0,
			gates: 0,
			neededYou: 0,
		});
		expect(before.perNight[0]?.night).toBe(TODAY - 13 * DAY);
		expect(before.perNight.at(-1)?.night).toBe(TODAY - 7 * DAY);
	});

	test("count the runs that needed you by the day they started, and why", () => {
		const summary = summarize(
			[
				aRun({
					id: "answered",
					flowName: "triage",
					createdAt: TODAY + HOUR,
					neededYou: [
						{ reason: "gate", at: TODAY + 2 * HOUR },
						{ reason: "gate", at: TODAY + 3 * HOUR },
						{ reason: "took-over", at: TODAY + 4 * HOUR },
					],
				}),
				// Started yesterday, resumed today: it counts on the day it started.
				aRun({
					id: "resumed",
					flowName: "triage",
					createdAt: TODAY - DAY + HOUR,
					neededYou: [{ reason: "resumed", at: TODAY + HOUR }],
				}),
				aRun({ id: "alone", flowName: "digest", createdAt: TODAY + HOUR }),
				// From an older Host: it says nothing, so it needed nobody.
				aRun({ id: "old", flowName: "digest", createdAt: TODAY - DAY }),
			],
			project(["triage", "digest"]),
		);
		const range = daysOf(summary, 7);
		expect(range.totals.neededYou).toBe(2);
		expect(range.totals.perNight.at(-1)).toMatchObject({
			runs: 2,
			neededYou: 1,
		});
		expect(range.totals.perNight.at(-2)).toMatchObject({
			runs: 2,
			neededYou: 1,
		});
		expect(range.needed).toMatchObject({
			runs: 4,
			needed: 2,
			reasons: [
				{ reason: "gate", runs: 1 },
				{ reason: "resumed", runs: 1 },
				{ reason: "took-over", runs: 1 },
			],
			groups: {
				rows: [{ label: "triage", runs: 2, needed: 2 }],
				count: 1,
			},
		});
		expect(range.needed?.perNight.at(-1)).toEqual({
			night: TODAY,
			counts: { needed: 1, alone: 1 },
		});
		expect(range.needed?.latest).toEqual([
			{
				runId: "answered",
				runTitle: expect.any(String),
				group: "triage",
				createdAt: TODAY + HOUR,
				reasons: ["gate", "took-over"],
			},
			{
				runId: "resumed",
				runTitle: expect.any(String),
				group: "triage",
				createdAt: TODAY - DAY + HOUR,
				reasons: ["resumed"],
			},
		]);
		// Flow health: the flow's own runs, the share and why.
		expect(
			summary.flowHealth?.rows.map((row) => [row.name, row.neededYou]),
		).toEqual([
			[
				"triage",
				{
					runs: 2,
					needed: 2,
					reasons: [
						{ reason: "gate", runs: 1 },
						{ reason: "resumed", runs: 1 },
						{ reason: "took-over", runs: 1 },
					],
				},
			],
			["digest", { runs: 2, needed: 0, reasons: [] }],
		]);
	});

	test("count a day from midnight to midnight on the reader's clock", () => {
		// 23:30 and 00:30 UTC, the night into 21 October.
		const runs = [
			aRun({ id: "late", createdAt: TODAY - HOUR / 2 }),
			aRun({ id: "early", createdAt: TODAY + HOUR / 2 }),
		];
		const inUtc = daysOf(summarize(runs), 7).totals.perNight;
		expect(inUtc.at(-1)).toMatchObject({ night: TODAY, runs: 1 });
		expect(inUtc.at(-2)).toMatchObject({ night: TODAY - DAY, runs: 1 });
		// In Amsterdam (UTC+2) both are on 21 October, which began at 22:00 UTC.
		const inAmsterdam = summarizeDashboard(runs, {
			now: NOW,
			timeZone: "Europe/Amsterdam",
			scope: project(),
		});
		const days = daysOf(inAmsterdam, 7).totals.perNight;
		expect(days.at(-1)).toMatchObject({ night: TODAY - 2 * HOUR, runs: 2 });
		expect(inAmsterdam.lastNight?.night).toBe(TODAY - 2 * HOUR);
		expect(inAmsterdam.lastNight?.runs).toBe(2);
	});

	test("the days before reach over a clock change, a day of 25 hours", () => {
		// Amsterdam leaves summer time on 25 October 2026.
		const now = parseInstant("2026-10-27T10:00:00Z");
		const summary = summarizeDashboard(
			[aRun({ createdAt: parseInstant("2026-10-25T22:30:00Z") })],
			{ now, timeZone: "Europe/Amsterdam", scope: project() },
		);
		const { totals } = daysOf(summary, 7);
		expect(totals.perNight.map((day) => iso(day.night)).slice(-3)).toEqual([
			"2026-10-24T22:00:00.000Z",
			"2026-10-25T23:00:00.000Z",
			"2026-10-26T23:00:00.000Z",
		]);
		// 23:30 on 25 October in Amsterdam: the day of 25 hours.
		expect(totals.perNight.at(-3)?.runs).toBe(1);
	});

	test("give Flow health per range on a project, and none over all projects", () => {
		const summary = summarize(
			[
				aRun({ flowName: "night", createdAt: TODAY + HOUR }),
				aRun({ flowName: "night", createdAt: TODAY - 20 * DAY }),
			],
			project(["night"]),
		);
		expect(daysOf(summary, 7).flows?.rows[0]?.runs).toBe(1);
		expect(daysOf(summary, 30).flows?.rows[0]?.runs).toBe(2);
		expect(daysOf(summarize([], all({})), 7).flows).toBeNull();
	});
});

describe("Gates over a range of days", () => {
	test("tell answered, not answered and waiting Gates apart, and how fast you answered", () => {
		const range = daysOf(
			summarize([
				aRun({
					status: "finished",
					endedAt: NOW - HOUR,
					gates: [
						{
							openedAt: NOW - 3 * HOUR,
							closedAt: NOW - 2 * HOUR,
							answeredBy: "person",
						},
						{
							openedAt: NOW - 2 * HOUR,
							closedAt: NOW - 2 * HOUR + 60_000,
							answeredBy: "person",
						},
						// Nobody answered: the deadline chose.
						{
							openedAt: NOW - 2 * HOUR,
							closedAt: NOW - HOUR,
							answeredBy: "deadline",
						},
					],
				}),
				// The run stopped while its Gate waited.
				aRun({
					status: "stopped",
					endedAt: NOW - HOUR,
					gates: [
						{
							openedAt: NOW - 90 * 60_000,
							closedAt: NOW - HOUR,
							answeredBy: null,
						},
					],
				}),
				aRun({
					flowName: "fix",
					status: "waiting",
					gates: [
						{ openedAt: NOW - HOUR / 2, closedAt: null, answeredBy: null },
					],
				}),
			]),
			30,
		).gates;
		expect(range.asked).toBe(5);
		expect(range.runsAsking).toBe(3);
		expect(range.answered).toBe(2);
		expect(range.unanswered).toBe(2);
		expect(range.answerTime?.median).toBe((HOUR + 60_000) / 2);
		expect(range.states).toEqual(["answered", "unanswered", "waiting"]);
		expect(range.perNight.at(-1)?.counts).toEqual({
			answered: 2,
			unanswered: 2,
			waiting: 1,
		});
		expect(range.latest[0]).toMatchObject({
			state: "waiting",
			wait: HOUR / 2,
			group: "fix",
		});
		expect(range.groups.rows[0]).toMatchObject({
			label: "night",
			asked: 4,
			answered: 2,
			unanswered: 2,
			typical: (HOUR + 60_000) / 2,
			longest: HOUR,
		});
		expect(range.groups.rows[1]).toMatchObject({ label: "fix", waiting: 1 });
	});
});

describe("the project dashboard", () => {
	test("shows the latest day with runs, its newest runs first", () => {
		const summary = summarize([
			aRun({ id: "old", createdAt: TODAY - DAY, costUsd: 9 }),
			aRun({ id: "late", createdAt: TODAY + HOUR, costUsd: 1 }),
			aRun({ id: "later", createdAt: TODAY + 2 * HOUR, costUsd: 2 }),
		]);
		expect(summary.lastNight?.night).toBe(TODAY);
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

	test("gives each flow its last ten runs, newest first, of any day", () => {
		const summary = summarize(
			Array.from({ length: 12 }, (_, index) =>
				aRun({
					id: `r${index}`,
					flowName: "night",
					status: index % 2 === 0 ? "finished" : "failed",
					// One a day, the newest first; most older than 7 days.
					createdAt: NOW - HOUR - index * DAY,
				}),
			),
			project(["night"]),
		);
		const row = daysOf(summary, 7).flows?.rows[0];
		expect(row?.lastRuns.map((run) => run.runId)).toEqual(
			Array.from({ length: 10 }, (_, index) => `r${index}`),
		);
		expect(row?.last).toEqual(row?.lastRuns[0] ?? null);
		expect(row?.runs).toBe(7);
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

	test("list the failing flows once each, the ones that still fail first", () => {
		const range = daysOf(
			summarize([
				aRun({
					flowName: "night",
					status: "failed",
					createdAt: NOW - 4 * HOUR,
				}),
				aRun({
					id: "night-newest",
					flowName: "night",
					status: "failed",
					reason: "The agent stopped.",
					createdAt: NOW - 3 * HOUR,
				}),
				aRun({ flowName: "fix", status: "failed", createdAt: NOW - HOUR }),
				aRun({
					flowName: "fix",
					status: "finished",
					createdAt: NOW - HOUR / 2,
				}),
				aRun({ flowName: "fix", status: "finished", createdAt: NOW }),
				aRun({
					flowName: "night",
					projectId: "p2",
					status: "failed",
					createdAt: NOW - 5 * HOUR,
				}),
			]),
			7,
		).runs;
		expect(range.stillFailing).toBe(2);
		expect(range.failing.count).toBe(3);
		expect(range.failing.rows.map((flow) => flow.key)).toEqual([
			"p1/night",
			"p2/night",
			"p1/fix",
		]);
		expect(range.failing.rows[0]).toMatchObject({
			title: "night",
			runId: "night-newest",
			reason: "The agent stopped.",
			failed: 2,
			fixedAt: null,
		});
		expect(range.failing.rows[2]?.fixedAt).toBe(NOW - HOUR / 2);
	});
});

describe("what a useful result costs", () => {
	const answer = (value: number, score = "useful") => ({
		score,
		value,
		label: null,
		stepId: null,
		at: NOW,
		by: null,
	});
	const scored = (scores: ReturnType<typeof answer>[]) => ({
		wallMs: 1,
		agentMs: 1,
		gateWaitMs: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costBasis: "billed" as const,
		prUrl: null,
		scores,
	});

	test("divides what all the flow's own runs cost by the useful ones", () => {
		const runs = [
			aRun({ id: "yes", costUsd: 2, metrics: scored([answer(1)]) }),
			// The last answer counts.
			aRun({ id: "no", costUsd: 1, metrics: scored([answer(1), answer(0)]) }),
			// An older Host names the answer pr_useful.
			aRun({
				id: "old",
				costUsd: 1,
				metrics: scored([answer(1, "pr_useful")]),
			}),
			// No answer, and it did not finish: its cost counts all the same.
			aRun({ id: "failed", status: "failed", costUsd: 1.5 }),
			aRun({ id: "unknown", costUsd: 0.5, costMissing: 1 }),
			// Its runs as a subflow have no answer of their own.
			aRun({
				flowName: "deploy",
				costUsd: 9,
				metrics: scored([answer(1)]),
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
		];
		const expected = {
			answered: 3,
			useful: 2,
			costPerUseful: { costUsd: 3, costEstimated: false, costMissing: 1 },
		};

		const range = summarizeFlow("night", runs, {
			now: NOW,
			timeZone: "UTC",
		}).ranges[0];
		expect(range?.useful).toEqual(expected);
		// The answer has its own numbers: it is not a score row.
		expect(range?.scores).toEqual([]);

		const rows =
			daysOf(summarize(runs, project(["deploy", "night"])), 7).flows?.rows ??
			[];
		expect(rows.find((row) => row.name === "night")?.useful).toEqual(expected);
		expect(rows.find((row) => row.name === "deploy")?.useful).toEqual({
			answered: 1,
			useful: 1,
			costPerUseful: { costUsd: 9, costEstimated: false, costMissing: 0 },
		});
	});

	test("has no cost per useful result while no run was useful", () => {
		const range = summarizeFlow(
			"night",
			[
				aRun({ costUsd: 2, metrics: scored([answer(0)]) }),
				aRun({ costUsd: 1 }),
			],
			{ now: NOW, timeZone: "UTC" },
		).ranges[0];
		expect(range?.useful).toEqual({
			answered: 1,
			useful: 0,
			costPerUseful: null,
		});
	});
});

describe("the latest reports", () => {
	/** A run that ended at an End node that wrote a report. */
	const reported = (
		id: string,
		fields: Partial<RunSummary> & { endedAt: number },
	): RunSummary =>
		aRun({
			id,
			result: "done",
			report: { stepId: `${id}-end`, excerpt: `Report of ${id}`, more: false },
			...fields,
		});

	test("one row per flow, its newest report, the newest end first", () => {
		const summary = summarize(
			[
				reported("old", {
					createdAt: TODAY - 3 * DAY,
					endedAt: TODAY - 3 * DAY + HOUR,
				}),
				reported("new", {
					createdAt: TODAY - DAY,
					endedAt: TODAY - DAY + HOUR,
				}),
				reported("fix", {
					flowName: "fix",
					createdAt: TODAY + HOUR,
					endedAt: TODAY + 2 * HOUR,
					result: "nothing-to-do",
				}),
				aRun({ createdAt: TODAY, endedAt: TODAY + HOUR, result: "done" }),
			],
			project(["night", "fix"]),
		);
		const range = daysOf(summary, 7);
		expect(range.reports?.count).toBe(2);
		expect(range.reports?.rows[0]).toEqual({
			key: "p1/fix",
			group: "fix",
			title: "fix",
			runId: "fix",
			stepId: "fix-end",
			endedAt: TODAY + 2 * HOUR,
			result: "nothing-to-do",
			excerpt: "Report of fix",
			more: false,
		});
		expect(range.reports?.rows[1]).toMatchObject({
			key: "p1/night",
			runId: "new",
		});
	});

	test("count the runs that started in the range", () => {
		const summary = summarize([
			reported("ancient", {
				createdAt: TODAY - 40 * DAY,
				endedAt: TODAY - 40 * DAY + HOUR,
			}),
		]);
		expect(daysOf(summary, 30).reports).toEqual({ rows: [], count: 0 });
		expect(daysOf(summary, 90).reports?.rows.map((row) => row.runId)).toEqual([
			"ancient",
		]);
	});

	test("over all projects, a row names the project and the flow", () => {
		const summary = summarize(
			[reported("site", { createdAt: TODAY, endedAt: TODAY + HOUR })],
			all({ p1: "website" }),
		);
		expect(daysOf(summary, 7).reports?.rows[0]).toMatchObject({
			group: "website",
			title: "night",
		});
	});

	test("a Flow health row has its own newest report of any day, not one as a subflow", () => {
		const summary = summarize(
			[
				reported("long-ago", {
					createdAt: TODAY - 60 * DAY,
					endedAt: TODAY - 60 * DAY + HOUR,
				}),
				aRun({
					flowName: "fix",
					createdAt: TODAY,
					endedAt: TODAY + HOUR,
					result: "done",
					report: { stepId: "own", excerpt: "Fix report", more: true },
					subflows: [
						{
							flowName: "night",
							status: "finished",
							costUsd: 0,
							costEstimated: false,
							costMissing: 0,
							costCalls: 0,
							startedAt: TODAY,
							endedAt: TODAY + HOUR,
						},
					],
				}),
			],
			project(["night", "fix", "idle"]),
		);
		const rows = new Map(
			summary.flowHealth?.rows.map((row) => [row.name, row.report]),
		);
		expect(rows.get("night")).toEqual({
			runId: "long-ago",
			stepId: "long-ago-end",
			endedAt: TODAY - 60 * DAY + HOUR,
			result: "done",
			excerpt: "Report of long-ago",
			more: false,
		});
		expect(rows.get("fix")?.stepId).toBe("own");
		expect(rows.get("idle")).toBeUndefined();
	});
});

describe("test runs", () => {
	/** A run started from the editor with a pinned node (ADR 27). */
	const tried = (fields: Partial<RunSummary> = {}): RunSummary =>
		aRun({ test: { pinned: ["fetch"], skipped: [] }, ...fields });
	const metrics = (score: string) => ({
		wallMs: 1,
		agentMs: 1,
		gateWaitMs: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costBasis: "billed" as const,
		prUrl: null,
		scores: [{ score, value: 1, label: null, stepId: null, at: NOW, by: null }],
		ladder: [
			{
				ladder: "work" as const,
				nodeId: "write",
				rung: "first" as const,
				by: "agent" as const,
				tier: null,
				landed: 1,
				costUsd: 1,
				costEstimated: false,
				costMissing: 0,
			},
		],
	});
	const gate = {
		openedAt: TODAY + HOUR,
		closedAt: TODAY + 2 * HOUR,
		answeredBy: "person" as const,
	};
	const runs = () => [
		aRun({ id: "real", costUsd: 1, createdAt: TODAY + HOUR }),
		tried({
			id: "try",
			status: "failed",
			costUsd: 2,
			createdAt: TODAY + 2 * HOUR,
			endedAt: TODAY + 3 * HOUR,
			result: "done",
			report: { stepId: "try-end", excerpt: "A try", more: false },
			gates: [gate],
			neededYou: [{ reason: "gate", at: TODAY + 2 * HOUR }],
			metrics: metrics("useful"),
			subflows: [
				{
					flowName: "fetch",
					status: "failed",
					costUsd: 0.5,
					costEstimated: false,
					costMissing: 0,
					costCalls: 1,
					startedAt: TODAY + 2 * HOUR,
					endedAt: TODAY + 3 * HOUR,
				},
			],
		}),
	];

	test("count in the spend of a range of days, and in none of its other numbers", () => {
		const range = daysOf(summarize(runs(), project(["night", "fetch"])), 7);
		expect(range.totals).toMatchObject({
			runs: 1,
			ended: 1,
			finished: 1,
			costUsd: 3,
			gates: 0,
			neededYou: 0,
		});
		expect(range.spend.total).toBe(3);
		expect(range.spend.runs).toBe(2);
		expect(range.runs).toMatchObject({ runs: 1, failed: { count: 0 } });
		expect(range.runs.failing.count).toBe(0);
		expect(range.gates.asked).toBe(0);
		expect(range.needed).toMatchObject({ runs: 1, needed: 0 });
		expect(range.reports).toEqual({ rows: [], count: 0 });
	});

	test("stay out of Flow health, its last runs and its report, also as a subflow", () => {
		const summary = summarize(runs(), project(["night", "fetch"]));
		const rows = new Map(
			summary.flowHealth?.rows.map((row) => [row.name, row]),
		);
		expect(rows.get("night")).toMatchObject({
			runs: 1,
			finished: 1,
			ended: 1,
			lastRuns: [{ runId: "real" }],
			useful: { answered: 0, useful: 0, costPerUseful: null },
			neededYou: { runs: 1, needed: 0, reasons: [] },
			ladders: { work: null, choice: null },
		});
		expect(rows.get("night")?.report).toBeUndefined();
		expect(rows.get("fetch")).toMatchObject({ runs: 0, lastRuns: [] });
	});

	test("count in a flow's spend in detail, and say how many there were", () => {
		const range = summarizeFlow("night", runs(), {
			now: NOW,
			timeZone: "UTC",
		}).ranges[0];
		expect(range).toMatchObject({
			runs: 1,
			ended: 1,
			finished: 1,
			unfinished: 0,
			tests: 1,
			spent: { costUsd: 3 },
			spentUnfinished: { costUsd: 0 },
			latest: [{ runId: "real" }],
		});
		const today = range?.perNight.at(-1);
		expect(today?.counts).toEqual({ finished: 1 });
		expect(today?.spent?.costUsd).toBe(3);
		expect(today?.needed).toEqual({ runs: 1, needed: 0 });
		expect(today?.metrics).toEqual({});

		const called = summarizeFlow("fetch", runs(), {
			now: NOW,
			timeZone: "UTC",
		}).ranges[0];
		expect(called).toMatchObject({
			runs: 0,
			tests: 1,
			spent: { costUsd: 0.5 },
		});
	});

	test("count in the latest day's spend, which says how many there were", () => {
		const day = summarize(runs()).lastNight;
		expect(day).toMatchObject({ runs: 2, tests: 1, cost: { costUsd: 3 } });
		expect(day?.latest.map((run) => run.id)).toEqual(["try", "real"]);
		// A day without test runs says nothing of them.
		expect(
			summarize([aRun({ createdAt: TODAY + HOUR })]).lastNight,
		).not.toHaveProperty("tests");
	});

	test("do not make a latest day of their own: the latest day with a real run shows", () => {
		const day = summarize([
			aRun({ id: "work", costUsd: 1, createdAt: TODAY - DAY + HOUR }),
			tried({ id: "eve", costUsd: 2, createdAt: TODAY - DAY + 2 * HOUR }),
			tried({ id: "try", costUsd: 4, createdAt: TODAY + HOUR }),
		]).lastNight;
		expect(day?.night).toBe(TODAY - DAY);
		// That day keeps its own test runs, in the list and the spend.
		expect(day).toMatchObject({ runs: 2, tests: 1, cost: { costUsd: 3 } });
		expect(day?.latest.map((run) => run.id)).toEqual(["eve", "work"]);
	});

	test("make the latest day when no run is real, so they still show", () => {
		const day = summarize([
			tried({ id: "try", costUsd: 4, createdAt: TODAY + HOUR }),
		]).lastNight;
		expect(day).toMatchObject({ night: TODAY, runs: 1, tests: 1 });
		expect(day?.latest.map((run) => run.id)).toEqual(["try"]);
	});

	test("show at work with their pins and skips", () => {
		const summary = summarize([
			tried({ id: "try", status: "running", createdAt: TODAY + HOUR }),
			aRun({ id: "real", status: "running", createdAt: TODAY + 2 * HOUR }),
		]);
		expect(summary.open.rows.map((run) => [run.id, run.test])).toEqual([
			["try", { pinned: ["fetch"], skipped: [] }],
			["real", undefined],
		]);
		expect(summary.open.rows[1]).not.toHaveProperty("test");
		expect(summary.open.running).toBe(2);
	});
});

describe("the watch over the flows", () => {
	const failed = (hoursAgo: number, fields: Partial<RunSummary> = {}) =>
		aRun({
			status: "failed",
			createdAt: NOW - hoursAgo * HOUR,
			endedAt: NOW - hoursAgo * HOUR + 1000,
			...fields,
		});
	const finished = (hoursAgo: number, fields: Partial<RunSummary> = {}) =>
		aRun({
			createdAt: NOW - hoursAgo * HOUR,
			endedAt: NOW - hoursAgo * HOUR + 1000,
			...fields,
		});

	test("over all projects it lists the flows with a signal, the severe first", () => {
		const { watch } = summarize(
			[
				failed(1, { projectId: "p1", flowName: "digest" }),
				failed(2, { projectId: "p2", flowName: "sweep" }),
				failed(3, { projectId: "p2", flowName: "sweep" }),
				finished(4, { projectId: "p2", flowName: "quiet" }),
				// A quick run has no flow, and a test run is a try.
				failed(1, { flowName: null }),
				failed(1, { flowName: "tried", test: { pinned: [], skipped: [] } }),
			],
			all({ p1: "One", p2: "Two" }),
		);
		expect(watch?.watched).toBe(3);
		expect(watch?.flows.map((flow) => flow.key)).toEqual([
			"p2/sweep",
			"p1/digest",
		]);
		expect(watch?.flows[0]?.signals).toMatchObject([
			{ kind: "failing", severe: true, count: 2 },
		]);
	});

	test("a project's flow row carries its level and how often it needed you", () => {
		const act = (hoursAgo: number, planned: boolean) => ({
			reason: "gate" as const,
			at: NOW - hoursAgo * HOUR,
			planned,
		});
		const summary = summarize(
			[
				finished(1, { neededYou: [act(1, true)] }),
				finished(2, { neededYou: [act(2, false)] }),
				finished(3, { neededYou: [act(3, true)] }),
				finished(4),
			],
			project(["night"]),
		);
		const row = summary.flowHealth?.rows[0];
		expect(row?.watch?.level?.level).toBe("decide");
		expect(row?.watch?.attention).toMatchObject({ planned: 2, unplanned: 1 });
		expect(summary.watch?.levels).toEqual({ decide: 1, check: 0, own: 0 });
		expect(summary.watch?.perWeek.at(-1)).toBe(1);
	});
});
