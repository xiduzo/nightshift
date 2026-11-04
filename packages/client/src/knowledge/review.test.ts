import { describe, expect, test } from "bun:test";

import { arrangeTasks, type ReviewTask, taskLine } from "./review";

const ids = (tasks: { id: string }[]) => tasks.map((task) => task.id);

describe("arrangeTasks", () => {
	const tasks = [{ id: "a" }, { id: "b" }, { id: "c" }];
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
		expect(arranged({})).toEqual(["a", "b", "c"]);
	});

	test("a task that is gone leaves", () => {
		expect(arranged({ gone: new Set(["a"]) })).toEqual(["b", "c"]);
	});

	test("a task put off goes to the end, in the order they were put off", () => {
		expect(arranged({ later: ["b", "a"] })).toEqual(["c", "b", "a"]);
	});

	test("a task brought forward comes first, also when it was put off", () => {
		expect(arranged({ later: ["c"], forward: "c" })).toEqual(["c", "a", "b"]);
	});

	test("a task brought forward that is gone changes nothing", () => {
		expect(arranged({ gone: new Set(["c"]), forward: "c" })).toEqual([
			"a",
			"b",
		]);
	});
});

describe("a task in one line", () => {
	const line = (task: Partial<ReviewTask>) => taskLine(task as ReviewTask);

	test("a learning without readable text still has a line", () => {
		expect(
			line({
				kind: "learning",
				learning: {
					id: "one.md",
					projectId: "p1",
					notes: [],
					runId: "r",
					stepId: null,
					proposedAt: 1,
				},
			}),
		).toBe("A learning");
	});

	test("each kind says what waits", () => {
		expect(
			line({
				kind: "source",
				sync: { flow: "wiki" } as Extract<
					ReviewTask,
					{ kind: "source" }
				>["sync"],
			}),
		).toBe("Check wiki");
		expect(
			line({
				kind: "question",
				question: { query: "gold" } as Extract<
					ReviewTask,
					{ kind: "question" }
				>["question"],
			}),
		).toBe('Agents found nothing for "gold"');
		const file = { path: "a.md", size: 1, changedAt: 1 };
		expect(line({ kind: "unused", files: [file] })).toBe(
			"1 file that no run used",
		);
		expect(line({ kind: "unused", files: [file, file] })).toBe(
			"2 files that no run used",
		);
	});
});
