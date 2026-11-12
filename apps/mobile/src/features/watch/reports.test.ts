/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DashboardSummary } from "@nightshift/client";
import { utc } from "@nightshift/client/testing";
import { latestReports, reportLine, type WatchReport } from "./reports";

type Days = DashboardSummary["nights"][number];

const DAY = utc(2026, 10, 12);
const HOUR = 3_600_000;

function report(flow: string, endedAt: number): WatchReport {
	return {
		key: `p1/${flow}`,
		group: "research",
		title: flow,
		runId: `run-${flow}`,
		stepId: "end",
		endedAt,
		result: "done",
		excerpt: `## ${flow}\n\nWhat is new.`,
		more: false,
	};
}

/** A range of days with only its reports: Watch reads nothing else of it. */
function days(range: Days["nights"], reports?: WatchReport[]): Days {
	return {
		nights: range,
		...(reports ? { reports: { rows: reports, count: reports.length } } : {}),
	} as unknown as Days;
}

function summary(nights: Days[]): DashboardSummary {
	return { nights } as unknown as DashboardSummary;
}

describe("latestReports", () => {
	test("takes the reports of the last 7 days, at most three", () => {
		const week = ["a", "b", "c", "d"].map((flow, index) =>
			report(flow, DAY - index * HOUR),
		);
		const month = [report("e", DAY - 20 * 24 * HOUR)];
		expect(
			latestReports(summary([days(30, month), days(7, week)])).map(
				(row) => row.title,
			),
		).toEqual(["a", "b", "c"]);
	});

	test("is empty when no run wrote a report", () => {
		expect(latestReports(summary([days(7, [])]))).toEqual([]);
	});

	test("is empty when an older Host sends no reports", () => {
		expect(latestReports(summary([days(7)]))).toEqual([]);
		expect(latestReports(summary([]))).toEqual([]);
	});
});

describe("reportLine", () => {
	test("is the first line with words, without its Markdown", () => {
		expect(reportLine("## Market update\n\n- **Three** new entries")).toBe(
			"Market update",
		);
		expect(reportLine("\n\n[Three new papers](https://example.com)")).toBe(
			"Three new papers",
		);
	});

	test("is empty when the report has no words", () => {
		expect(reportLine("")).toBe("");
		expect(reportLine("```\n```")).toBe("");
	});
});
