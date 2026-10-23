/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { OpenGate, RunSummary } from "@nightshift/client";

import {
	matches,
	NEWEST_RUNS,
	queryWords,
	resultsText,
	searchGates,
	searchRuns,
} from "./search";

function gate(over: Partial<OpenGate>): OpenGate {
	return {
		spaceId: "s1",
		spaceName: "Personal",
		runId: "r1",
		runTitle: "feature-factory · WEB-142",
		flowName: "feature-factory",
		projectId: "p1",
		projectName: "website",
		stepId: "st1",
		nodeId: "review",
		question: "Approve the plan?\n\nPlan:\nShip it.",
		choices: [],
		lockScreen: false,
		openedAt: 1,
		answerPending: false,
		canAnswer: true,
		...over,
	} as OpenGate;
}

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

describe("matches", () => {
	test("needs every word somewhere in the fields, in any case", () => {
		const words = queryWords("  Plan  WEBSITE ");
		expect(words).toEqual(["plan", "website"]);
		expect(matches(words, ["Approve the plan", null, "website"])).toBe(true);
		expect(matches(words, ["Approve the plan", undefined])).toBe(false);
		expect(matches([], [])).toBe(true);
	});
});

describe("searchGates", () => {
	const gates = [
		gate({ stepId: "a" }),
		gate({
			stepId: "b",
			projectName: "zac",
			nodeId: "merge",
			question: "Merge the pull request?",
			flowName: null,
			runTitle: "fix the login",
			spaceName: "Dimpact",
		}),
	];

	test("keeps every Gate for a blank query", () => {
		expect(searchGates(gates, " ")).toEqual(gates);
	});

	test("finds a Gate by its question, project, flow, step and Space", () => {
		const ids = (query: string) =>
			searchGates(gates, query).map((found) => found.stepId);
		expect(ids("approve")).toEqual(["a"]);
		expect(ids("zac merge")).toEqual(["b"]);
		expect(ids("quick run")).toEqual(["b"]);
		expect(ids("dimpact")).toEqual(["b"]);
		expect(ids("WEB-142")).toEqual(["a"]);
		expect(ids("nothing")).toEqual([]);
	});

	test("does not search the context below the question", () => {
		expect(searchGates(gates, "ship")).toEqual([]);
	});
});

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
