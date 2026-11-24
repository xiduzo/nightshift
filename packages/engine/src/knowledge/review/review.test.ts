import { describe, expect, test } from "bun:test";
import type { KnowledgeFile } from "../files";
import type { ProjectLearning } from "../learnings";
import { learningNode, questionNode } from "../map";
import type { KnowledgeSync } from "../sources";
import { reviewTasks as tasksOf } from "./domain/review-tasks";
import type { AskedQuestion } from "./domain/use";

/** The rule with the Map's nodes, as `listReviewTasks` calls it. */
const reviewTasks = (input: Parameters<typeof tasksOf>[0]) =>
	tasksOf(input, { learning: learningNode, question: questionNode });

const sync = (flow: string, health: KnowledgeSync["health"]) =>
	({ flow, health }) as KnowledgeSync;
const learning = (id: string): ProjectLearning => ({
	id,
	projectId: "p1",
	notes: ["A note."],
	runId: "r",
	stepId: null,
	proposedAt: 1,
});
const question = (query: string, hits = 0) =>
	({
		query,
		times: 1,
		lastAt: 1,
		hits: Array.from({ length: hits }, () => ({ path: "a.md" })),
	}) as AskedQuestion;
const file = (path: string): KnowledgeFile => ({
	path,
	size: 1,
	changedAt: 1,
});

const ids = (tasks: { id: string }[]) => tasks.map((task) => task.id);

describe("reviewTasks", () => {
	test("what is broken first, then learnings, then what could be better", () => {
		expect(
			ids(
				reviewTasks({
					syncs: [sync("wiki", "failed"), sync("ok", null)],
					learnings: [learning("one.md")],
					asked: [question("gold"), question("found", 1)],
					unused: [file("a.md"), file("b.md")],
				}),
			),
		).toEqual(["source:wiki", "learning:one.md", "question:gold", "unused:2"]);
	});

	test("a source out of date needs a look too", () => {
		expect(
			ids(
				reviewTasks({
					syncs: [sync("wiki", "stale")],
					learnings: [],
					asked: [],
					unused: [],
				}),
			),
		).toEqual(["source:wiki"]);
	});

	test("more unused files make a new task, so a dismissed list asks again", () => {
		const of = (count: number) =>
			ids(
				reviewTasks({
					syncs: [],
					learnings: [],
					asked: [],
					unused: Array.from({ length: count }, (_, i) => file(`${i}.md`)),
				}),
			);
		expect(of(2)).not.toEqual(of(3));
	});

	test("a learning and a question name their node on the Map, a source none", () => {
		const nodes = reviewTasks({
			syncs: [sync("wiki", "failed")],
			learnings: [learning("one.md")],
			asked: [question("gold")],
			unused: [file("a.md")],
		}).map((task) => task.node);
		expect(nodes).toEqual([null, "learning:one.md", "question:gold", null]);
	});
});
