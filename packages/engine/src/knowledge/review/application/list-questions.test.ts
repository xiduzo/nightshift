import { describe, expect, test } from "bun:test";
import { reviewPorts } from "../test-support";
import { listAskedQuestions } from "./list-asked-questions";
import { listQuestions } from "./list-questions";

/** The use case listQuestions, over a database in memory. */

describe("listQuestions", () => {
	test("each question asked with the files a person marked, or null outside the set, and the set", async () => {
		const ports = await reviewPorts();
		for (const [query, at] of [
			["rollback", 1],
			["Deploy at night", 2],
		] as const) {
			await ports.logUse("p1", {
				type: "KnowledgeSearched",
				at,
				runId: null,
				stepId: null,
				payload: { query, hits: [] },
			});
		}
		const set = [
			{ query: "deploy  at night", answers: ["a.md"], markedAt: 1, by: null },
		];
		const listed = await listQuestions({
			asked: listAskedQuestions(ports),
			questionSet: async () => set,
		})({ projectId: "p1", limit: 5 });
		expect(listed.set).toEqual(set);
		expect(listed.asked.map(({ query, answers }) => [query, answers])).toEqual([
			["Deploy at night", ["a.md"]],
			["rollback", null],
		]);
	});
});
