/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { RunSummary } from "@nightshift/client";

import { NEWEST_RUNS, resultsText, searchRuns } from "./search";

function run(id: string, over: Partial<RunSummary> = {}): RunSummary {
	return {
		id,
		projectId: "p1",
		title: "nightly-check",
		flowName: "nightly-check",
		branch: `nightshift/${id}`,
		status: "finished",
		createdAt: 0,
		...over,
	} as RunSummary;
}

describe("searchRuns", () => {
	const names = (id: string) => (id === "p1" ? "website" : undefined);

	test("shows the newest runs for a blank query", () => {
		const runs = Array.from({ length: NEWEST_RUNS + 2 }, (_, index) =>
			run(`r${index}`, { createdAt: index }),
		);
		const found = searchRuns(runs, "", names);
		expect(found).toHaveLength(NEWEST_RUNS);
		expect(found[0]?.id).toBe(`r${NEWEST_RUNS + 1}`);
	});

	test("finds a run by its title, branch, project and status word, newest first", () => {
		const runs = [
			run("old", { createdAt: 1 }),
			run("new", { createdAt: 2, status: "failed", title: "fix the login" }),
			run("other", { createdAt: 3, projectId: "p2" }),
		];
		const ids = (query: string) =>
			searchRuns(runs, query, names).map((found) => found.id);
		expect(ids("website")).toEqual(["new", "old"]);
		expect(ids("failed")).toEqual(["new"]);
		expect(ids("nightshift/other")).toEqual(["other"]);
		expect(ids("login")).toEqual(["new"]);
	});
});

describe("resultsText", () => {
	test("counts what it found, and says when nothing matches", () => {
		expect(resultsText("", 1, 10)).toBe("1 Gate and 10 runs");
		expect(resultsText("plan", 2, 1)).toBe("2 Gates and 1 run match");
		expect(resultsText(" plan ", 0, 0)).toBe('Nothing matches "plan"');
	});
});
