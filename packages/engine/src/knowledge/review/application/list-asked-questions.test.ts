import { describe, expect, test } from "bun:test";
import { reviewPorts } from "../test-support";
import { listAskedQuestions } from "./list-asked-questions";

/** The use case listAskedQuestions, over a database in memory. */

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
		const ports = await reviewPorts();
		await ports.logUse("p1", search("Deploy  at night", 1, ["old.md"]));
		await ports.logUse("p1", search("rollback", 2));
		await ports.logUse("p1", search("deploy at night", 3, ["a.md"]));
		const asked = await listAskedQuestions(ports)({ projectId: "p1" });
		expect(
			asked.map(({ query, times, lastAt }) => [query, times, lastAt]),
		).toEqual([
			["deploy at night", 2, 3],
			["rollback", 1, 2],
		]);
		expect(asked[0]?.hits.map((hit) => hit.path)).toEqual(["a.md"]);
		expect(ports.reads).toEqual([{ projectId: "p1", limit: 2_000 }]);
		expect(
			await listAskedQuestions(ports)({ projectId: "p1", limit: 1 }),
		).toHaveLength(1);
	});
});
