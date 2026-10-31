/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { RunStatus, RunSummary } from "@nightshift/client";

import {
	countedFilters,
	emptyFilterTitle,
	filterCounts,
	filterRuns,
	filterStatuses,
	inFilter,
	ofProject,
	rowValue,
	runFilterOf,
	runRowLabel,
	runsSummary,
	startedShort,
} from "./runs-list";

const MIN = 60_000;
/** 23 Oct 2026, 10:00 local time. */
const NOW = new Date(2026, 9, 23, 10, 0).getTime();

type Row = Pick<
	RunSummary,
	"id" | "status" | "createdAt" | "projectId" | "gates" | "sleeps" | "title"
>;

function run(fields: Partial<Row> & { status: RunStatus }): Row {
	return {
		id: fields.id ?? fields.status,
		createdAt: NOW - 60 * MIN,
		projectId: "website",
		gates: [],
		sleeps: [],
		title: "Feature factory · WEB-142",
		...fields,
	};
}

const RUNS: Row[] = [
	run({ id: "a", status: "running", createdAt: NOW - 5 * MIN }),
	run({ id: "b", status: "sleeping", createdAt: NOW - 50 * MIN }),
	run({ id: "c", status: "waiting", createdAt: NOW - 20 * MIN }),
	run({
		id: "d",
		status: "failed",
		createdAt: NOW - 90 * MIN,
		projectId: "api",
	}),
	run({ id: "e", status: "interrupted", createdAt: NOW - 95 * MIN }),
	run({ id: "f", status: "finished", createdAt: NOW - 30 * MIN }),
	run({ id: "g", status: "stopped", createdAt: NOW - 10 * MIN }),
];

describe("runFilterOf", () => {
	test("reads the filter of a link, and shows every run for anything else", () => {
		expect(runFilterOf("failed")).toBe("failed");
		expect(runFilterOf(["needs-you", "failed"])).toBe("needs-you");
		expect(runFilterOf(undefined)).toBe("all");
		expect(runFilterOf("ended")).toBe("all");
	});
});

describe("inFilter", () => {
	test("a sleeping run runs, an interrupted run failed, a stopped one shows only under All", () => {
		expect(inFilter("sleeping", "running")).toBe(true);
		expect(inFilter("waiting", "needs-you")).toBe(true);
		expect(inFilter("interrupted", "failed")).toBe(true);
		expect(inFilter("stopped", "finished")).toBe(false);
		expect(inFilter("stopped", "failed")).toBe(false);
		expect(inFilter("stopped", "all")).toBe(true);
	});
});

describe("filterCounts", () => {
	test("counts the runs each chip shows", () => {
		expect(filterCounts(RUNS)).toEqual({
			all: 7,
			running: 2,
			"needs-you": 1,
			failed: 2,
			finished: 1,
		});
		expect(filterCounts([]).all).toBe(0);
	});
});

describe("filterRuns and ofProject", () => {
	test("shows the runs of the filter, newest first", () => {
		expect(filterRuns(RUNS, "all").map((r) => r.id)).toEqual([
			"a",
			"g",
			"c",
			"f",
			"b",
			"d",
			"e",
		]);
		expect(filterRuns(RUNS, "running").map((r) => r.id)).toEqual(["a", "b"]);
		expect(filterRuns(RUNS, "failed").map((r) => r.id)).toEqual(["d", "e"]);
	});

	test("keeps one project's runs, or every run", () => {
		expect(ofProject(RUNS, "api").map((r) => r.id)).toEqual(["d"]);
		expect(ofProject(RUNS, null)).toHaveLength(7);
	});
});

describe("startedShort", () => {
	test("the time today, Yesterday, then the date", () => {
		expect(startedShort(new Date(2026, 9, 23, 9, 41).getTime(), NOW)).toBe(
			"09:41",
		);
		expect(startedShort(new Date(2026, 9, 22, 23, 5).getTime(), NOW)).toBe(
			"Yesterday",
		);
		expect(startedShort(new Date(2026, 9, 3, 14, 20).getTime(), NOW)).toMatch(
			/3/,
		);
	});
});

describe("rowValue", () => {
	test("a run on its way: how long it has run so far", () => {
		expect(
			rowValue(run({ status: "running", createdAt: NOW - 12 * MIN }), NOW),
		).toEqual({
			value: "12 min",
			valueLabel: "12 min so far",
		});
	});

	test("a run on its way: the time it slept or waited for you does not count", () => {
		const sleeping = run({
			status: "sleeping",
			createdAt: NOW - 60 * MIN,
			gates: [
				{
					openedAt: NOW - 50 * MIN,
					closedAt: NOW - 40 * MIN,
					answeredBy: null,
				},
			],
			sleeps: [
				{ from: NOW - 30 * MIN, to: NOW - 20 * MIN },
				{ from: NOW - 15 * MIN, to: null },
			],
		});
		expect(rowValue(sleeping, NOW)).toEqual({
			value: "25 min",
			valueLabel: "25 min so far",
		});
	});

	test("a waiting run: how long its oldest open Gate has waited", () => {
		const waiting = run({
			status: "waiting",
			createdAt: NOW - 90 * MIN,
			gates: [
				{
					openedAt: NOW - 80 * MIN,
					closedAt: NOW - 70 * MIN,
					answeredBy: null,
				},
				{ openedAt: NOW - 25 * MIN, closedAt: null, answeredBy: null },
				{ openedAt: NOW - 5 * MIN, closedAt: null, answeredBy: null },
			],
		});
		expect(rowValue(waiting, NOW)).toEqual({
			value: "25 min",
			valueLabel: "waited 25 min",
		});
	});

	test("an ended run: when it started", () => {
		const ended = run({
			status: "finished",
			createdAt: new Date(2026, 9, 23, 6, 30).getTime(),
		});
		expect(rowValue(ended, NOW)).toEqual({
			value: "06:30",
			valueLabel: "started Today 06:30",
		});
	});
});

describe("runsSummary and runRowLabel", () => {
	test("the line under the title", () => {
		expect(runsSummary(12, null)).toBe("Newest first · 12 runs");
		expect(runsSummary(1, "website")).toBe("website · Newest first · 1 run");
	});

	test("a row reads as one sentence", () => {
		expect(
			runRowLabel(run({ status: "running" }), "website", "12 min so far"),
		).toBe("Running, Feature factory · WEB-142, website, 12 min so far");
		expect(runRowLabel(run({ status: "failed" }), null, "started 09:41")).toBe(
			"Failed, Feature factory · WEB-142, started 09:41",
		);
	});

	test("an empty filter says what it looked for", () => {
		expect(emptyFilterTitle("needs-you")).toBe("No run needs you");
		expect(emptyFilterTitle("failed")).toBe("No failed runs");
	});
});

describe("the chips on a Host that counts runs", () => {
	const projects = [
		{
			id: "website",
			runs: { statuses: { running: 1, sleeping: 2, failed: 1 } },
		},
		{ id: "api", runs: { statuses: { finished: 3, interrupted: 1 } } },
	];

	test("count the runs of every project, or of one", () => {
		expect(countedFilters(projects, null)).toEqual({
			all: 8,
			running: 3,
			"needs-you": 0,
			failed: 2,
			finished: 3,
		});
		expect(countedFilters(projects, "api")?.failed).toBe(1);
	});

	test("are null on an older Host, which sends no counts", () => {
		expect(countedFilters([{ id: "website" }], null)).toBeNull();
		expect(countedFilters(undefined, null)).toBeNull();
	});

	test("ask the Host for their statuses", () => {
		expect(filterStatuses("all")).toBeUndefined();
		expect(filterStatuses("failed")).toEqual(["failed", "interrupted"]);
	});
});
