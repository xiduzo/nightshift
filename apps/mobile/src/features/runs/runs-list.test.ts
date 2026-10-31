/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { RunStatus, RunSummary } from "@nightshift/client";

import {
	byNight,
	countedFilters,
	filterCounts,
	filterStatuses,
	inFilter,
	nightLabel,
	runFilterOf,
	runMeta,
	runPlace,
	shownRuns,
} from "./runs-list";

const MIN = 60_000;
/** Saturday 31 Oct 2026, 07:12 local time. */
const NOW = new Date(2026, 9, 31, 7, 12).getTime();

type Row = Pick<
	RunSummary,
	| "id"
	| "status"
	| "createdAt"
	| "endedAt"
	| "projectId"
	| "gates"
	| "title"
	| "flowName"
	| "costUsd"
	| "costMissing"
	| "costCalls"
>;

function run(fields: Partial<Row> & { status: RunStatus }): Row {
	return {
		id: fields.id ?? fields.status,
		createdAt: NOW - 60 * MIN,
		endedAt: null,
		projectId: "website",
		gates: [],
		title: "Feature factory · WEB-142",
		flowName: "Feature factory",
		costUsd: 0,
		costMissing: 0,
		costCalls: 0,
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
		title: "Bump Expo",
		flowName: "Dependency bump",
	}),
	run({ id: "e", status: "interrupted", createdAt: NOW - 95 * MIN }),
	run({ id: "f", status: "finished", createdAt: NOW - 30 * MIN }),
	run({ id: "g", status: "stopped", createdAt: NOW - 10 * MIN }),
];

const NAMES: Record<string, string> = { website: "website", api: "api-server" };
const projectName = (id: string) => NAMES[id];

describe("runFilterOf", () => {
	test("reads the filter of a link, and shows every run for anything else", () => {
		expect(runFilterOf("failed")).toBe("failed");
		expect(runFilterOf("stopped")).toBe("stopped");
		expect(runFilterOf(["needs-you", "failed"])).toBe("needs-you");
		expect(runFilterOf(undefined)).toBe("all");
		expect(runFilterOf("ended")).toBe("all");
	});
});

describe("inFilter", () => {
	test("a sleeping run runs, a stopped or interrupted run stopped", () => {
		expect(inFilter("sleeping", "running")).toBe(true);
		expect(inFilter("waiting", "needs-you")).toBe(true);
		expect(inFilter("interrupted", "stopped")).toBe(true);
		expect(inFilter("stopped", "stopped")).toBe(true);
		expect(inFilter("interrupted", "failed")).toBe(false);
		expect(inFilter("stopped", "finished")).toBe(false);
		expect(inFilter("stopped", "all")).toBe(true);
	});
});

describe("filterCounts", () => {
	test("counts the runs each chip shows", () => {
		expect(filterCounts(RUNS)).toEqual({
			all: 7,
			running: 2,
			"needs-you": 1,
			failed: 1,
			stopped: 2,
			finished: 1,
		});
		expect(filterCounts([]).all).toBe(0);
	});
});

describe("shownRuns", () => {
	const all = {
		projectId: null,
		filter: "all" as const,
		query: "",
		projectName,
	};

	test("shows the runs of the chip, newest first", () => {
		expect(shownRuns(RUNS, all).map((r) => r.id)).toEqual([
			"a",
			"g",
			"c",
			"f",
			"b",
			"d",
			"e",
		]);
		expect(
			shownRuns(RUNS, { ...all, filter: "running" }).map((r) => r.id),
		).toEqual(["a", "b"]);
		expect(
			shownRuns(RUNS, { ...all, filter: "stopped" }).map((r) => r.id),
		).toEqual(["g", "e"]);
	});

	test("keeps one project's runs", () => {
		expect(
			shownRuns(RUNS, { ...all, projectId: "api" }).map((r) => r.id),
		).toEqual(["d"]);
	});

	test("finds runs by title, flow or project name", () => {
		const found = (query: string) =>
			shownRuns(RUNS, { ...all, query }).map((r) => r.id);
		expect(found("expo")).toEqual(["d"]);
		expect(found("dependency")).toEqual(["d"]);
		expect(found("API-SERVER")).toEqual(["d"]);
		expect(found("nothing like it")).toEqual([]);
		expect(found("  ")).toHaveLength(7);
	});
});

describe("nightLabel", () => {
	const at = (day: number, hour: number, minute = 0) =>
		new Date(2026, 9, day, hour, minute).getTime();

	test("a night runs from noon to noon", () => {
		expect(nightLabel(at(31, 6, 40), NOW)).toBe("Last night");
		expect(nightLabel(at(30, 23, 10), NOW)).toBe("Last night");
		expect(nightLabel(at(30, 12, 0), NOW)).toBe("Last night");
		expect(nightLabel(at(30, 11, 59), NOW)).toBe("Thursday night");
	});

	test("since noon today is Today", () => {
		const afternoon = at(31, 15, 0);
		expect(nightLabel(at(31, 13, 0), afternoon)).toBe("Today");
		expect(nightLabel(at(31, 9, 0), afternoon)).toBe("Last night");
		expect(nightLabel(at(30, 22, 0), afternoon)).toBe("Last night");
	});

	test("the week before by its weekday, older nights by their date", () => {
		expect(nightLabel(at(29, 1, 0), NOW)).toBe("Wednesday night");
		expect(nightLabel(at(26, 2, 0), NOW)).toBe("Sunday night");
		expect(nightLabel(at(24, 22, 0), NOW)).toBe("Night of 24 October");
		expect(nightLabel(new Date(2025, 11, 30, 23).getTime(), NOW)).toBe(
			"Night of 30 December 2025",
		);
	});
});

describe("byNight", () => {
	test("groups runs, newest first, under the night they started in", () => {
		const runs = [
			run({ id: "late", status: "running", createdAt: NOW - 30 * MIN }),
			run({ id: "early", status: "finished", createdAt: NOW - 8 * 60 * MIN }),
			run({ id: "before", status: "failed", createdAt: NOW - 30 * 60 * MIN }),
		];
		expect(
			byNight(runs, NOW).map((night) => [
				night.label,
				night.runs.map((r) => r.id),
			]),
		).toEqual([
			["Last night", ["late", "early"]],
			["Thursday night", ["before"]],
		]);
	});
});

describe("runMeta and runPlace", () => {
	const at = (hour: number, minute: number) =>
		new Date(2026, 9, 31, hour, minute).getTime();

	test("a run on its way: since it started", () => {
		expect(runMeta(run({ status: "running", createdAt: at(6, 40) }))).toBe(
			"since 06:40",
		);
	});

	test("a waiting run: since its oldest open Gate", () => {
		const waiting = run({
			status: "waiting",
			createdAt: at(4, 20),
			gates: [
				{ openedAt: at(4, 50), closedAt: at(5, 0), answeredBy: null },
				{ openedAt: at(5, 48), closedAt: null, answeredBy: null },
				{ openedAt: at(6, 30), closedAt: null, answeredBy: null },
			],
		});
		expect(runMeta(waiting)).toBe("since 05:48");
	});

	test("an ended run: when it ended, and its cost when known", () => {
		expect(
			runMeta(
				run({
					status: "finished",
					endedAt: at(2, 5),
					costUsd: 2.61,
					costCalls: 4,
				}),
			),
		).toBe("02:05 · $2.61");
		expect(runMeta(run({ status: "failed", endedAt: at(1, 22) }))).toBe(
			"01:22",
		);
	});

	test("the project and the flow", () => {
		expect(runPlace(run({ status: "running" }), "website")).toBe(
			"website · Feature factory",
		);
		expect(runPlace(run({ status: "running", flowName: null }), null)).toBe(
			"Quick run",
		);
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
			failed: 1,
			stopped: 1,
			finished: 3,
		});
		expect(countedFilters(projects, "api")?.stopped).toBe(1);
	});

	test("are null on an older Host, which sends no counts", () => {
		expect(countedFilters([{ id: "website" }], null)).toBeNull();
		expect(countedFilters(undefined, null)).toBeNull();
	});

	test("ask the Host for their statuses", () => {
		expect(filterStatuses("all")).toBeUndefined();
		expect(filterStatuses("stopped")).toEqual(["stopped", "interrupted"]);
	});
});
