/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { OpenGate } from "@nightshift/client";

import { matches, queryWords, searchGates } from "./match";

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
