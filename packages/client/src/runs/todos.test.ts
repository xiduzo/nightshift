import { describe, expect, test } from "bun:test";
import { stepTodos } from "./todos";

const todoWrite = (todos: unknown[], name = "TodoWrite") => ({
	name,
	input: { todos },
});

describe("stepTodos", () => {
	test("is undefined when the step wrote no list", () => {
		expect(stepTodos([])).toBeUndefined();
		expect(
			stepTodos([{ name: "Read", input: { file_path: "a.ts" } }]),
		).toBeUndefined();
	});

	test("reads Claude Code's TodoWrite, with the running item's active form", () => {
		expect(
			stepTodos([
				todoWrite([
					{ content: "Read the code", status: "completed" },
					{
						content: "Run the tests",
						status: "in_progress",
						activeForm: "Running the tests",
					},
					{ content: "Open a PR", status: "pending" },
				]),
			]),
		).toEqual([
			{ content: "Read the code", status: "completed" },
			{
				content: "Run the tests",
				status: "in_progress",
				activeForm: "Running the tests",
			},
			{ content: "Open a PR", status: "pending" },
		]);
	});

	test("the newest list wins", () => {
		const todos = stepTodos([
			todoWrite([{ content: "A", status: "in_progress" }]),
			{ name: "Edit", input: {} },
			todoWrite([
				{ content: "A", status: "completed" },
				{ content: "B", status: "pending" },
			]),
		]);
		expect(todos?.map((todo) => todo.status)).toEqual(["completed", "pending"]);
	});

	test("a call whose input has not arrived keeps the list before it", () => {
		const todos = stepTodos([
			todoWrite([{ content: "A", status: "pending" }]),
			{ name: "TodoWrite" },
		]);
		expect(todos).toEqual([{ content: "A", status: "pending" }]);
	});

	test("an emptied list hides the plan", () => {
		expect(
			stepTodos([
				todoWrite([{ content: "A", status: "pending" }]),
				todoWrite([]),
			]),
		).toBeUndefined();
	});

	test("reads OpenCode's todowrite, cancelled items included", () => {
		expect(
			stepTodos([
				todoWrite(
					[
						{ id: "1", content: "A", status: "cancelled", priority: "high" },
						{ id: "2", content: "B", status: "in_progress", priority: "low" },
					],
					"todowrite",
				),
			]),
		).toEqual([
			{ content: "A", status: "cancelled" },
			{ content: "B", status: "in_progress" },
		]);
	});

	test("reads Codex's todo_list from its answer", () => {
		expect(
			stepTodos([
				{
					name: "todo_list",
					input: {},
					result: JSON.stringify({
						items: [
							{ text: "Plan", completed: true },
							{ text: "Build", completed: false },
						],
					}),
				},
			]),
		).toEqual([
			{ content: "Plan", status: "completed" },
			{ content: "Build", status: "pending" },
		]);
	});

	test("skips items without text and unknown statuses fall back to pending", () => {
		expect(
			stepTodos([
				todoWrite([{ content: "  " }, { content: "A", status: "blocked" }, 7]),
			]),
		).toEqual([{ content: "A", status: "pending" }]);
	});
});
