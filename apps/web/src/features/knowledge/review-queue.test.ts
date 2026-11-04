import { describe, expect, test } from "bun:test";
import {
	type AskedQuestion,
	arrangeTasks,
	type KnowledgeSync,
	reviewTasks,
	taskLine,
	taskNode,
	type WaitingLearning,
} from "./review-queue";

const sync = (flow: string, health: KnowledgeSync["health"]) =>
	({ flow, health }) as KnowledgeSync;
const learning = (id: string, notes = ["A note."]) =>
	({ id, notes, runId: "r", stepId: null, proposedAt: 1 }) as WaitingLearning;
const question = (query: string, hits = 0) =>
	({
		query,
		times: 1,
		lastAt: 1,
		hits: Array.from({ length: hits }, () => ({ path: "a.md" })),
	}) as AskedQuestion;
const file = (path: string) => ({ path, size: 1, changedAt: 1 });

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

	test("nothing waits: no tasks", () => {
		expect(
			reviewTasks({ syncs: [], learnings: [], asked: [], unused: [] }),
		).toEqual([]);
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
});

describe("arrangeTasks", () => {
	const tasks = reviewTasks({
		syncs: [],
		learnings: [learning("a"), learning("b"), learning("c")],
		asked: [],
		unused: [],
	});
	const arranged = (state: Partial<Parameters<typeof arrangeTasks>[1]>) =>
		ids(
			arrangeTasks(tasks, {
				gone: new Set(),
				later: [],
				forward: null,
				...state,
			}),
		);

	test("keeps the order when nothing happened", () => {
		expect(arranged({})).toEqual(["learning:a", "learning:b", "learning:c"]);
	});

	test("a task that is gone leaves", () => {
		expect(arranged({ gone: new Set(["learning:a"]) })).toEqual([
			"learning:b",
			"learning:c",
		]);
	});

	test("a task put off goes to the end, in the order they were put off", () => {
		expect(arranged({ later: ["learning:b", "learning:a"] })).toEqual([
			"learning:c",
			"learning:b",
			"learning:a",
		]);
	});

	test("a task brought forward comes first, also when it was put off", () => {
		expect(arranged({ later: ["learning:c"], forward: "learning:c" })).toEqual([
			"learning:c",
			"learning:a",
			"learning:b",
		]);
	});

	test("a task brought forward that is gone changes nothing", () => {
		expect(
			arranged({ gone: new Set(["learning:c"]), forward: "learning:c" }),
		).toEqual(["learning:a", "learning:b"]);
	});
});

describe("words and nodes of a task", () => {
	test("a learning and a question have a node on the map", () => {
		const [a, b, c] = reviewTasks({
			syncs: [sync("wiki", "failed")],
			learnings: [learning("one.md")],
			asked: [question("gold")],
			unused: [],
		});
		expect(a && taskNode(a)).toBeNull();
		expect(b && taskNode(b)).toBe("learning:one.md");
		expect(c && taskNode(c)).toBe("question:gold");
	});

	test("a learning without readable text still has a line", () => {
		const [task] = reviewTasks({
			syncs: [],
			learnings: [learning("one.md", [])],
			asked: [],
			unused: [],
		});
		expect(task && taskLine(task)).toBe("A learning");
	});
});
