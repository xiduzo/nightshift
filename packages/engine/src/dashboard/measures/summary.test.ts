import { describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import type { RunSummary } from "../../read";
import { NO_METRICS } from "../adapters/out/in-memory-neighbours";
import { type DashboardScope, summarizeDashboard } from "./domain/summary";

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
		neededYou: [],
		metrics: NO_METRICS,
		lastActivityAt: NOW - HOUR,
		endReason: "finished",
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

describe("a flow's row", () => {
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
});

describe("what a Flow health row counts", () => {
	test("a flow's row has its cost, its length, and what the runs that did not finish spent", () => {
		const row = summarize(
			[
				aRun({
					status: "finished",
					costUsd: 1,
					createdAt: NOW - 3 * HOUR,
					endedAt: NOW - 2 * HOUR,
				}),
				aRun({
					status: "finished",
					costUsd: 3,
					createdAt: NOW - 2 * HOUR,
					endedAt: NOW - HOUR,
				}),
				// Asked no agent, or with a cost that is not known: not in the cost.
				aRun({ status: "finished", costCalls: 0, endedAt: NOW }),
				aRun({ status: "finished", costUsd: 70, costMissing: 2, endedAt: NOW }),
				aRun({ status: "failed", costUsd: 5 }),
				aRun({ status: "interrupted", costUsd: 0 }),
				aRun({ status: "stopped", costUsd: 0.5 }),
				// Not ended: in the runs only.
				aRun({ status: "running", costUsd: 8 }),
				aRun({ status: "sleeping", costUsd: 8 }),
				aRun({ flowName: "other", costUsd: 100 }),
			],
			project(["night"]),
		).flowHealth?.rows[0];
		expect(row).toMatchObject({
			runs: 9,
			rate: 57,
			unknownCost: 1,
			freeRuns: 1,
			unfinished: { count: 3, costUsd: 5.5, tokens: 0 },
		});
		expect(row?.cost).toEqual({
			min: 1,
			q1: 1.5,
			median: 2,
			q3: 2.5,
			max: 3,
			count: 2,
		});
		expect(row?.watch.length?.median).toBe(HOUR);
	});

	test("a flow's row has the tokens its runs reported, beside the same runs' cost", () => {
		const tokens = (input: number, output: number) => ({
			metrics: {
				...NO_METRICS,
				tokens: { input, output, cacheRead: 9, cacheWrite: 9 },
			},
		});
		const row = summarize(
			[
				aRun({ costUsd: 1, ...tokens(12_000, 345) }),
				aRun({ costUsd: 1, ...tokens(100, 1) }),
				aRun({ status: "failed", ...tokens(50, 5) }),
				aRun({ status: "stopped", ...tokens(40, 4) }),
			],
			project(["night"]),
		).flowHealth?.rows[0];
		expect(row?.tokenUse).toMatchObject({ min: 101, max: 12_345, count: 2 });
		expect(row?.unfinished.tokens).toBe(99);
		// A run as a subflow reports no tokens of its own: the spreads would differ.
		const called = summarize(
			[
				aRun({ costUsd: 1, ...tokens(100, 1) }),
				aRun({
					flowName: "deploy",
					...tokens(1, 1),
					subflows: [
						{
							flowName: "night",
							status: "finished",
							costUsd: 4,
							costEstimated: false,
							costMissing: 0,
							costCalls: 1,
							startedAt: NOW - HOUR,
							endedAt: NOW,
						},
					],
				}),
			],
			project(["night"]),
		).flowHealth?.rows[0];
		expect(called).toMatchObject({ cost: { count: 2 }, tokenUse: null });
	});

	test("a range counts its first day whole, on the reader's clock, a subflow run too", () => {
		const subflow = (startedAt: number) => ({
			flowName: "night",
			status: "finished" as const,
			costUsd: 0,
			costEstimated: false,
			costMissing: 0,
			costCalls: 0,
			startedAt,
			endedAt: startedAt,
		});
		const start = TODAY - 6 * DAY;
		const runs = [
			aRun({ createdAt: start }),
			aRun({ createdAt: start - HOUR }),
			// Its own start counts, not that of the run that called it.
			aRun({
				flowName: "deploy",
				createdAt: start - HOUR / 2,
				subflows: [subflow(start - HOUR / 2), subflow(start)],
			}),
		];
		const countIn = (timeZone: string) =>
			daysOf(
				summarizeDashboard(runs, {
					now: NOW,
					timeZone,
					scope: project(["night"]),
				}),
				7,
			).flows?.rows[0]?.runs;
		expect(countIn("UTC")).toBe(2);
		expect(countIn("Europe/Amsterdam")).toBe(4);
	});

	test("the ranges are 7, 30 and 90 days, and Flow health covers 30", () => {
		const summary = summarize(
			[6, 29, 30, 89, 90].map((days) =>
				aRun({ createdAt: TODAY - days * DAY }),
			),
			project(["night"]),
		);
		expect(
			summary.nights.map((range) => [range.nights, range.flows?.rows[0]?.runs]),
		).toEqual([
			[7, 1],
			[30, 2],
			[90, 4],
		]);
		expect(summary.flowHealth?.rows[0]?.runs).toBe(2);
	});

	test("flows with as many runs stand by their last run, and five show", () => {
		const names = ["a", "b", "c", "d", "e", "f"];
		const { flowHealth } = summarize(
			names.map((flowName, index) =>
				aRun({ flowName, createdAt: NOW - (6 - index) * HOUR }),
			),
			project(names),
		);
		expect(flowHealth?.rows.map((row) => row.name)).toEqual([
			"f",
			"e",
			"d",
			"c",
			"b",
		]);
		expect(flowHealth?.count).toBe(6);
	});
});

describe("the latest day", () => {
	test("is a day from midnight to midnight on the reader's clock", () => {
		// 23:30 and 00:30 UTC, the night into 21 October.
		const runs = [
			aRun({ id: "late", createdAt: TODAY - HOUR / 2 }),
			aRun({ id: "early", createdAt: TODAY + HOUR / 2 }),
		];
		expect(summarize(runs).lastNight?.latest.map((run) => run.id)).toEqual([
			"early",
		]);
		// In Amsterdam (UTC+2) both are on 21 October, which began at 22:00 UTC.
		const inAmsterdam = summarizeDashboard(runs, {
			now: NOW,
			timeZone: "Europe/Amsterdam",
			scope: project(),
		});
		expect(inAmsterdam.lastNight?.latest.map((run) => run.id)).toEqual([
			"early",
			"late",
		]);
	});

	test("shows five whole runs, each with its group", () => {
		const { lastNight } = summarize([
			...Array.from({ length: 6 }, (_, index) =>
				aRun({ id: `r${index}`, createdAt: TODAY + index * HOUR }),
			),
			aRun({ id: "quick", flowName: null, createdAt: TODAY + 7 * HOUR }),
		]);
		expect(lastNight?.latest.map((run) => [run.id, run.group])).toEqual([
			["quick", "Quick runs"],
			["r5", "night"],
			["r4", "night"],
			["r3", "night"],
			["r2", "night"],
		]);
		expect(lastNight?.latest[1]).toMatchObject({
			branch: expect.any(String),
			projectId: "p1",
			status: "finished",
		});
	});

	test("over all projects it covers the Space, each run under its project", () => {
		const { lastNight } = summarize(
			[
				aRun({ id: "site", createdAt: TODAY + HOUR }),
				aRun({ id: "lost", projectId: "gone", createdAt: TODAY }),
			],
			all({ p1: "website" }),
		);
		expect(lastNight?.latest.map((run) => [run.id, run.group])).toEqual([
			["site", "website"],
			["lost", "Removed"],
		]);
	});
});
describe("the ranges of days", () => {
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

describe("the project dashboard", () => {
	test("shows the latest day with runs, its newest runs first", () => {
		const summary = summarize([
			aRun({ id: "old", createdAt: TODAY - DAY, costUsd: 9 }),
			aRun({ id: "late", createdAt: TODAY + HOUR, costUsd: 1 }),
			aRun({ id: "later", createdAt: TODAY + 2 * HOUR, costUsd: 2 }),
		]);
		expect(summary.lastNight?.latest.map((run) => run.id)).toEqual([
			"later",
			"late",
		]);
		expect(summarize([]).lastNight).toBeNull();
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

	test("the first day of a range counts whole, on the reader's clock", () => {
		const onDay = (id: string, createdAt: number) =>
			reported(id, { flowName: id, createdAt, endedAt: TODAY + HOUR });
		// 22:30 UTC, half past midnight in Amsterdam: the first of 7 days there.
		const runs = [
			onDay("eve", TODAY - 6 * DAY - HOUR - HOUR / 2),
			onDay("first", TODAY - 6 * DAY),
		];
		expect(
			daysOf(summarize(runs), 7).reports.rows.map((row) => row.runId),
		).toEqual(["first"]);
		const inAmsterdam = summarizeDashboard(runs, {
			now: NOW,
			timeZone: "Europe/Amsterdam",
			scope: project(),
		});
		expect(
			daysOf(inAmsterdam, 7)
				.reports.rows.map((row) => row.runId)
				.sort(),
		).toEqual(["eve", "first"]);
	});

	test("the days of a range reach over a clock change, a day of 25 hours", () => {
		// Amsterdam leaves summer time on 25 October 2026. Seven days before
		// the end of the 27th begin at midnight of the 21st, in summer time.
		const now = parseInstant("2026-10-27T10:00:00Z");
		const started = (id: string, at: string) =>
			reported(id, {
				flowName: id,
				createdAt: parseInstant(at),
				endedAt: now,
			});
		const summary = summarizeDashboard(
			[
				started("before", "2026-10-20T21:30:00Z"),
				started("first", "2026-10-20T22:30:00Z"),
			],
			{ now, timeZone: "Europe/Amsterdam", scope: project() },
		);
		expect(daysOf(summary, 7).reports.rows.map((row) => row.runId)).toEqual([
			"first",
		]);
	});

	test("a quick run has a row under its prompt, and a flow one per project", () => {
		const times = { createdAt: TODAY, endedAt: TODAY + HOUR };
		const { rows } = daysOf(
			summarize([
				reported("quick", {
					...times,
					endedAt: TODAY + 3 * HOUR,
					flowName: null,
					title: "Read the news",
				}),
				reported("here", { ...times, endedAt: TODAY + 2 * HOUR }),
				reported("there", { ...times, projectId: "p2" }),
			]),
			7,
		).reports;
		expect(rows.map((row) => [row.key, row.group, row.title])).toEqual([
			["p1/Read the news", "Quick runs", "Read the news"],
			["p1/night", "night", "night"],
			["p2/night", "night", "night"],
		]);
	});

	test("shows five rows and how many flows have one", () => {
		const reports = daysOf(
			summarize(
				Array.from({ length: 7 }, (_, index) =>
					reported(`r${index}`, {
						flowName: `flow-${index}`,
						createdAt: TODAY,
						endedAt: TODAY + index * HOUR,
					}),
				),
			),
			7,
		).reports;
		expect(reports.rows.map((row) => row.runId)).toEqual([
			"r6",
			"r5",
			"r4",
			"r3",
			"r2",
		]);
		expect(reports.count).toBe(7);
	});

	test("a run that has not ended, or wrote no report, has no row", () => {
		const report = { stepId: "end", excerpt: "So far", more: false };
		const { reports } = daysOf(
			summarize([
				aRun({ status: "running", report, result: "done", endedAt: null }),
				aRun({ flowName: "fix", report, result: null, endedAt: NOW }),
				aRun({ flowName: "plain", result: "done", endedAt: NOW }),
			]),
			7,
		);
		expect(reports).toEqual({ rows: [], count: 0 });
	});

	test("a run of a removed project has its row under Removed", () => {
		const summary = summarize(
			[
				reported("site", { createdAt: TODAY, endedAt: TODAY + 2 * HOUR }),
				reported("lost", {
					projectId: "gone",
					createdAt: TODAY,
					endedAt: TODAY + HOUR,
				}),
			],
			all({ p1: "website" }),
		);
		expect(
			daysOf(summary, 7).reports.rows.map((row) => [row.runId, row.group]),
		).toEqual([
			["site", "website"],
			["lost", "Removed"],
		]);
		expect(summary.flowHealth).toBeNull();
	});
	test("a Flow health row has its own newest report of any day, not one as a subflow", () => {
		const summary = summarize(
			[
				reported("longer-ago", {
					createdAt: TODAY - 61 * DAY,
					endedAt: TODAY - 61 * DAY + HOUR,
				}),
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
			neededYou: [{ reason: "gate", at: TODAY + 2 * HOUR, planned: true }],
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

	test("stay out of Flow health, its last runs and its report, also as a subflow", () => {
		const summary = summarize(runs(), project(["night", "fetch"]));
		const rows = new Map(
			summary.flowHealth?.rows.map((row) => [row.name, row]),
		);
		expect(rows.get("night")).toMatchObject({
			runs: 1,
			lastRuns: [{ runId: "real" }],
			watch: { attention: { planned: 0, unplanned: 0 } },
		});
		expect(rows.get("night")?.report).toBeUndefined();
		expect(rows.get("fetch")).toMatchObject({ runs: 0, lastRuns: [] });
	});

	test("write no report that counts, also next to a report of a real run", () => {
		const report = (id: string) => ({
			id,
			result: "done" as const,
			report: { stepId: `${id}-end`, excerpt: id, more: false },
		});
		const summary = summarize([
			aRun({
				...report("real"),
				createdAt: TODAY + HOUR,
				endedAt: TODAY + 2 * HOUR,
			}),
			tried({
				...report("try"),
				createdAt: TODAY + 3 * HOUR,
				endedAt: TODAY + 4 * HOUR,
			}),
			tried({
				...report("other"),
				flowName: "fetch",
				createdAt: TODAY + 3 * HOUR,
				endedAt: TODAY + 4 * HOUR,
			}),
		]);
		for (const days of [7, 30, 90] as const) {
			const { reports } = daysOf(summary, days);
			expect(reports.rows.map((row) => row.runId)).toEqual(["real"]);
			expect(reports.count).toBe(1);
		}
	});

	test("show in the list of the latest day, with the real runs of that day", () => {
		const day = summarize(runs()).lastNight;
		expect(day?.latest.map((run) => [run.id, run.test])).toEqual([
			["try", { pinned: ["fetch"], skipped: [] }],
			["real", undefined],
		]);
	});
	test("do not make a latest day of their own: the latest day with a real run shows", () => {
		const day = summarize([
			aRun({ id: "work", costUsd: 1, createdAt: TODAY - DAY + HOUR }),
			tried({ id: "eve", costUsd: 2, createdAt: TODAY - DAY + 2 * HOUR }),
			tried({ id: "try", costUsd: 4, createdAt: TODAY + HOUR }),
		]).lastNight;
		// That day keeps its own test runs in the list.
		expect(day?.latest.map((run) => run.id)).toEqual(["eve", "work"]);
	});

	test("make the latest day when no run is real, so they still show", () => {
		const day = summarize([
			tried({ id: "try", costUsd: 4, createdAt: TODAY + HOUR }),
		]).lastNight;
		expect(day?.latest.map((run) => run.id)).toEqual(["try"]);
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
