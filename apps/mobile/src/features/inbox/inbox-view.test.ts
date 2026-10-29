/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { OpenGate } from "@nightshift/client";

import {
	ALL_GATES,
	choicesText,
	gateRowText,
	inboxGroups,
	inboxSummary,
	inPlace,
	nextGate,
	placeLabel,
	placeOptions,
	samePlace,
	spaceCount,
} from "./inbox-view";

const MIN = 60_000;

function gate(fields: Partial<OpenGate>): OpenGate {
	return {
		spaceId: "home",
		spaceName: "Home",
		runId: "r1",
		runTitle: "Feature factory · Fix login",
		flowName: "Feature factory",
		projectId: "web",
		projectName: "website",
		stepId: "s1",
		nodeId: "review",
		question: "Review the plan?",
		choices: [{ name: "approve" }, { name: "reject", color: "red" }],
		lockScreen: false,
		openedAt: 0,
		walker: { thisDevice: true, name: null },
		answerPending: false,
		canAnswer: true,
		...fields,
	} as OpenGate;
}

const a = gate({ runId: "a", openedAt: 1 * MIN });
const b = gate({
	runId: "b",
	openedAt: 2 * MIN,
	projectId: "api",
	projectName: "api",
});
const c = gate({ runId: "c", openedAt: 3 * MIN });
const d = gate({
	runId: "d",
	openedAt: 4 * MIN,
	spaceId: "acme",
	spaceName: "Acme",
	projectId: "shop",
	projectName: "shop",
});

describe("inboxGroups", () => {
	test("groups by project, the longest wait first", () => {
		const groups = inboxGroups([a, b, c], ALL_GATES, false);
		expect(groups.map((group) => group.title)).toEqual(["website", "api"]);
		expect(groups[0]?.gates.map((one) => one.runId)).toEqual(["a", "c"]);
	});

	test("newest first turns groups and Gates around", () => {
		const groups = inboxGroups(
			[a, b, c],
			{ ...ALL_GATES, sort: "newest" },
			false,
		);
		expect(groups.map((group) => group.title)).toEqual(["website", "api"]);
		expect(groups[0]?.gates.map((one) => one.runId)).toEqual(["c", "a"]);
	});

	test("names the Space when you are in more than one", () => {
		const groups = inboxGroups([a, d], ALL_GATES, true);
		expect(groups.map((group) => group.title)).toEqual([
			"Home · website",
			"Acme · shop",
		]);
	});

	test("shows one project or one Space", () => {
		const project = inboxGroups(
			[a, b, c, d],
			{ ...ALL_GATES, place: { kind: "project", projectId: "api" } },
			false,
		);
		expect(project.map((group) => group.key)).toEqual(["home:api"]);
		const space = inboxGroups(
			[a, b, c, d],
			{ ...ALL_GATES, place: { kind: "space", spaceId: "acme" } },
			true,
		);
		expect(
			space.flatMap((group) => group.gates.map((one) => one.runId)),
		).toEqual(["d"]);
	});
});

describe("places", () => {
	test("a Gate is in its Space and its project", () => {
		expect(inPlace(d, { kind: "all" })).toBe(true);
		expect(inPlace(d, { kind: "space", spaceId: "acme" })).toBe(true);
		expect(inPlace(d, { kind: "project", projectId: "web" })).toBe(false);
	});

	test("two places are the same by their id", () => {
		expect(samePlace({ kind: "all" }, { kind: "all" })).toBe(true);
		expect(
			samePlace(
				{ kind: "project", projectId: "web" },
				{ kind: "project", projectId: "web" },
			),
		).toBe(true);
		expect(
			samePlace(
				{ kind: "space", spaceId: "web" },
				{ kind: "project", projectId: "web" },
			),
		).toBe(false);
	});

	test("the picker lists every Gate, then the projects by name", () => {
		expect(
			placeOptions([a, b, c], false).map((option) => [
				option.label,
				option.count,
				option.nested,
			]),
		).toEqual([
			["All Gates", 3, false],
			["api", 1, false],
			["website", 2, false],
		]);
	});

	test("with more Spaces, each Space comes with its projects under it", () => {
		expect(
			placeOptions([a, b, d], true).map((option) => [
				option.label,
				option.count,
				option.nested,
			]),
		).toEqual([
			["All Gates", 3, false],
			["Acme", 1, false],
			["shop", 1, true],
			["Home", 2, false],
			["api", 1, true],
			["website", 1, true],
		]);
	});

	test("the chip names the place", () => {
		expect(placeLabel({ kind: "all" }, [a])).toBe("Project");
		expect(placeLabel({ kind: "project", projectId: "api" }, [a, b])).toBe(
			"api",
		);
		expect(placeLabel({ kind: "space", spaceId: "acme" }, [d])).toBe("Acme");
		expect(placeLabel({ kind: "project", projectId: "gone" }, [a])).toBe(
			"Project",
		);
	});
});

describe("inboxSummary", () => {
	test("counts the Gates you may answer, and the Spaces", () => {
		expect(inboxSummary([])).toBe("Nothing needs you");
		expect(inboxSummary([a])).toBe("1 Gate needs you");
		expect(inboxSummary([a, b, gate({ canAnswer: false })])).toBe(
			"2 Gates need you",
		);
		expect(inboxSummary([a, d])).toBe("2 Gates need you · 2 Spaces");
		expect(spaceCount([a, b, d])).toBe(2);
	});
});

describe("gateRowText", () => {
	test("project and flow, the headline, the choices and how long it waited", () => {
		const row = gateRowText(
			gate({
				question: "Ship the fix?\n\nBranch:\nfix/login",
				openedAt: 0,
			}),
			12 * MIN,
		);
		expect(row).toEqual({
			overline: "website · Feature factory",
			title: "Ship the fix?",
			choices: "2 choices",
			nodeId: "review",
			waited: "12 min",
			pullRequest: false,
		});
	});

	test("the headline shows without Markdown marks", () => {
		const row = gateRowText(
			gate({ question: "**Ship** the [fix](https://x)?" }),
			0,
		);
		expect(row.title).toBe("Ship the fix?");
	});

	test("a Gate that links a pull request shows its icon", () => {
		const row = gateRowText(
			gate({
				question:
					"Merge it?\n\nPull request: https://github.com/acme/web/pull/7",
			}),
			0,
		);
		expect(row.pullRequest).toBe(true);
	});

	test("a quick run", () => {
		expect(gateRowText(gate({ flowName: null }), 0).overline).toBe(
			"website · Quick run",
		);
	});

	test("one choice, many choices", () => {
		expect(choicesText(1)).toBe("1 choice");
		expect(choicesText(3)).toBe("3 choices");
	});
});

describe("nextGate", () => {
	test("the oldest other Gate you may answer", () => {
		const readOnly = gate({ runId: "x", openedAt: 0, canAnswer: false });
		const pending = gate({ runId: "y", openedAt: 0, answerPending: true });
		expect(nextGate([readOnly, pending, a, b, c], a)?.runId).toBe("b");
		expect(nextGate([a], a)).toBeNull();
	});
});
