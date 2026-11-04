import { describe, expect, test } from "bun:test";

import {
	canKeep,
	learningKey,
	mayDecide,
	stillWaiting,
	type WaitingLearning,
} from "./learnings";

function learning(projectId: string, id: string): WaitingLearning {
	return {
		id,
		projectId,
		runId: "r1",
		stepId: "s1",
		notes: ["The tests run with bun test."],
		proposedAt: 0,
	};
}

describe("the learnings that still wait", () => {
	const list = [learning("p1", "a"), learning("p1", "b"), learning("p2", "a")];

	test("are all of them when you settled none", () => {
		expect(stillWaiting(list, new Set())).toEqual(list);
	});

	test("leave out the ones you keep or delete, in their own project only", () => {
		const shown = stillWaiting(
			list,
			new Set([learningKey(learning("p1", "a"))]),
		);
		expect(shown.map(learningKey)).toEqual(["p1:b", "p2:a"]);
	});
});

describe("what you may do with a learning", () => {
	test("keep waits for notes you can read", () => {
		expect(canKeep(learning("p1", "a"))).toBe(true);
		expect(canKeep({ notes: [] })).toBe(false);
	});

	test("a role that may not decide gets no choice", () => {
		expect(mayDecide({ mayDecide: false })).toBe(false);
		expect(mayDecide({ mayDecide: true })).toBe(true);
	});

	test("a Host of an older version does not say: the server decides at the tap", () => {
		expect(mayDecide({})).toBe(true);
	});
});
