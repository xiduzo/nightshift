import { describe, expect, test } from "bun:test";

import {
	type Learning,
	learningKey,
	stillWaiting,
	waitingText,
} from "./waiting";

function learning(projectId: string, id: string): Learning {
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

describe("the count of the learnings that wait", () => {
	test("says one or more", () => {
		expect(waitingText(1)).toBe("1 learning waits for you");
		expect(waitingText(3)).toBe("3 learnings wait for you");
	});
});
