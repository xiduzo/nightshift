import { describe, expect, test } from "bun:test";
import { inMemoryReviewPorts } from "../adapters/out/in-memory-neighbours";
import { listAskedQuestions } from "./list-asked-questions";
import { listQuestions } from "./list-questions";

/** The use case listQuestions, on in-memory adapters. */

describe("listQuestions", () => {
	test("each question asked with the files a person marked, or null outside the set, and the set", async () => {
		const ports = inMemoryReviewPorts();
		for (const [query, at] of [
			["rollback", 1],
			["Deploy at night", 2],
		] as const) {
			ports.log.log("p1", {
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
		ports.questionSet.sets.set("p1", set);
		const listed = await listQuestions({
			asked: listAskedQuestions(ports),
			questionSet: ports.questionSet,
		})({ projectId: "p1", limit: 5 });
		expect(listed.set).toEqual(set);
		expect(listed.asked.map(({ query, answers }) => [query, answers])).toEqual([
			["Deploy at night", ["a.md"]],
			["rollback", null],
		]);
	});
});
