import { describe, expect, test } from "bun:test";
import type { FlowReport } from "@/shared/api";
import { latestReports, noReportsText } from "./reports";

const row = (n: number): FlowReport => ({
	key: `p1/flow-${n}`,
	group: "Research",
	title: `flow-${n}`,
	runId: `r${n}`,
	stepId: `s${n}`,
	endedAt: 1_000 - n,
	result: "done",
	excerpt: "## What is new\n\n- One",
	more: false,
});

describe("Home's latest reports", () => {
	test("an older Host sends none: the card hides", () => {
		expect(latestReports(undefined)).toBeNull();
	});

	test("no report in the range: no rows, the empty line", () => {
		expect(latestReports({ rows: [], count: 0 })).toEqual({
			rows: [],
			count: 0,
			hidden: 0,
		});
		expect(noReportsText(30)).toBe(
			"No run wrote a report in the last 30 days. Add one to an End node.",
		);
		expect(noReportsText(7)).toContain("the last 7 days");
	});

	test("at most five rows, newest first, and the flows it leaves out", () => {
		const rows = [1, 2, 3, 4, 5, 6].map(row);
		const shown = latestReports({ rows, count: 9 });
		expect(shown?.rows.map((r) => r.key)).toEqual([
			"p1/flow-1",
			"p1/flow-2",
			"p1/flow-3",
			"p1/flow-4",
			"p1/flow-5",
		]);
		expect(shown?.count).toBe(9);
		expect(shown?.hidden).toBe(4);
	});
});
