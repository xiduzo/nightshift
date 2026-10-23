/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
	choicesText,
	clonesText,
	gateLook,
	lastRunText,
	needsYouText,
	newestFirst,
	projectOverviews,
	projectsSummary,
	remoteParts,
	runTime,
} from "./overview";

const MINUTE = 60_000;
const NOW = new Date(2026, 9, 23, 9, 0).getTime();

describe("projectOverviews", () => {
	const projects = [{ id: "web" }, { id: "api" }, { id: "docs" }];
	const gates = [
		{ projectId: "web", canAnswer: true },
		{ projectId: "web", canAnswer: true },
		{ projectId: "web", canAnswer: false },
		{ projectId: "api", canAnswer: false },
		{ projectId: "elsewhere", canAnswer: true },
	];
	const runs = [
		{ id: "r1", projectId: "web", createdAt: 100 },
		{ id: "r3", projectId: "web", createdAt: 300 },
		{ id: "r2", projectId: "web", createdAt: 200 },
		{ id: "a1", projectId: "api", createdAt: 50 },
	];

	test("counts only the Gates you may answer, per project", () => {
		const rows = projectOverviews(projects, gates, runs);
		expect(rows.map((row) => row.needsYou)).toEqual([2, 0, 0]);
	});

	test("takes the newest run of each project, and null without runs", () => {
		const rows = projectOverviews(projects, gates, runs);
		expect(rows.map((row) => row.lastRun?.id ?? null)).toEqual([
			"r3",
			"a1",
			null,
		]);
	});

	test("keeps the order of the projects", () => {
		const rows = projectOverviews([...projects].reverse(), [], []);
		expect(rows.map((row) => row.project.id)).toEqual(["docs", "api", "web"]);
	});

	test("two runs of the same moment keep one order", () => {
		const same = [
			{ id: "a", projectId: "web", createdAt: 5 },
			{ id: "b", projectId: "web", createdAt: 5 },
		];
		expect(projectOverviews(projects, [], same)[0]?.lastRun?.id).toBe("b");
		expect(
			projectOverviews(projects, [], [...same].reverse())[0]?.lastRun?.id,
		).toBe("b");
	});
});

test("newestFirst sorts the runs of a project, newest first", () => {
	const runs = [
		{ id: "r1", projectId: "web", createdAt: 100 },
		{ id: "r3", projectId: "web", createdAt: 300 },
		{ id: "r2", projectId: "web", createdAt: 200 },
	];
	expect(newestFirst(runs).map((run) => run.id)).toEqual(["r3", "r2", "r1"]);
	expect(runs[0]?.id).toBe("r1");
});

describe("the words", () => {
	test("needsYouText counts Gates", () => {
		expect(needsYouText(0)).toBe("Nothing needs you");
		expect(needsYouText(1)).toBe("1 Gate needs you");
		expect(needsYouText(3)).toBe("3 Gates need you");
	});

	test("projectsSummary counts the projects and what needs you", () => {
		expect(projectsSummary(1, 0)).toBe("1 project");
		expect(projectsSummary(4, 2)).toBe("4 projects · 2 Gates need you");
	});

	test("lastRunText says how long ago and which run", () => {
		expect(lastRunText(null, NOW)).toBe("No runs yet");
		expect(
			lastRunText(
				{ title: "website · WEB-142", createdAt: NOW - 3 * 60 * MINUTE },
				NOW,
			),
		).toBe("Last run 3 h ago · website · WEB-142");
	});

	test("clonesText names one or two computers, and counts more", () => {
		expect(clonesText([])).toBeNull();
		expect(clonesText([{ deviceName: "MacBook Pro" }])).toBe("On MacBook Pro");
		expect(
			clonesText([{ deviceName: "MacBook Pro" }, { deviceName: null }]),
		).toBe("On MacBook Pro and a computer");
		expect(
			clonesText([
				{ deviceName: "A" },
				{ deviceName: "B" },
				{ deviceName: "C" },
			]),
		).toBe("On 3 computers");
	});

	test("choicesText counts choices", () => {
		expect(choicesText(1)).toBe("1 choice");
		expect(choicesText(2)).toBe("2 choices");
	});
});

describe("remoteParts", () => {
	test("finds the owner and the web address", () => {
		expect(remoteParts("github.com/acme/app")).toEqual({
			owner: "acme",
			url: "https://github.com/acme/app",
		});
		expect(remoteParts("gitlab.example.com/group/sub/app/")).toEqual({
			owner: "sub",
			url: "https://gitlab.example.com/group/sub/app",
		});
		expect(remoteParts("https://github.com/acme/app")).toEqual({
			owner: "acme",
			url: "https://github.com/acme/app",
		});
	});

	test("has no owner for a short remote, and nothing without one", () => {
		expect(remoteParts("example.com/app")).toEqual({
			owner: null,
			url: "https://example.com/app",
		});
		expect(remoteParts(null)).toBeNull();
		expect(remoteParts("  ")).toBeNull();
	});
});

test("gateLook: a Gate you may answer needs you", () => {
	expect(gateLook({ canAnswer: true }).label).toBe("Needs you");
	expect(gateLook({ canAnswer: true }).tone).toBe("waiting");
	expect(gateLook({ canAnswer: false })).toEqual({
		tone: "neutral",
		icon: "hand",
		label: "Waits for another person",
	});
});

describe("runTime", () => {
	test("a run on its way shows how long it has taken", () => {
		for (const status of ["running", "waiting", "sleeping"] as const) {
			expect(runTime({ status, createdAt: NOW - 12 * MINUTE }, NOW)).toEqual({
				value: "12 min",
				label: "started 12 min ago",
			});
		}
	});

	test("an ended run shows when it started", () => {
		expect(
			runTime({ status: "finished", createdAt: NOW - 3 * 60 * MINUTE }, NOW),
		).toEqual({ value: "3 h ago", label: "started 3 h ago" });
	});
});
