import { describe, expect, test } from "bun:test";

import { canKeep, type WaitingLearning } from "./learnings";

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

describe("what you may do with a learning", () => {
	test("keep waits for notes you can read", () => {
		expect(canKeep(learning("p1", "a"))).toBe(true);
		expect(canKeep({ notes: [] })).toBe(false);
	});
});
