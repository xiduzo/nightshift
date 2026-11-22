import { describe, expect, test } from "bun:test";
import { inMemoryReviewPorts } from "../adapters/out/in-memory-neighbours";
import { listAskedQuestions } from "./list-asked-questions";

/** The use case listAskedQuestions, on in-memory adapters. */

const search = (query: string, at: number, paths: string[] = []) => ({
	type: "KnowledgeSearched" as const,
	at,
	runId: null,
	stepId: null,
	payload: {
		query,
		hits: paths.map((path) => ({
			path,
			section: null,
			line: 1,
			page: null,
			found: ["words" as const],
		})),
	},
});

describe("listAskedQuestions", () => {
	test("each question once, newest first, from the latest 2 000 searches, at most the limit", async () => {
		const ports = inMemoryReviewPorts();
		ports.log.log("p1", search("Deploy  at night", 1, ["old.md"]));
		ports.log.log("p1", search("rollback", 2));
		ports.log.log("p1", search("deploy at night", 3, ["a.md"]));
		const asked = await listAskedQuestions(ports)({ projectId: "p1" });
		expect(
			asked.map(({ query, times, lastAt }) => [query, times, lastAt]),
		).toEqual([
			["deploy at night", 2, 3],
			["rollback", 1, 2],
		]);
		expect(asked[0]?.hits.map((hit) => hit.path)).toEqual(["a.md"]);
		expect(ports.log.reads).toEqual([{ projectId: "p1", limit: 2_000 }]);
		expect(
			await listAskedQuestions(ports)({ projectId: "p1", limit: 1 }),
		).toHaveLength(1);
	});
});
