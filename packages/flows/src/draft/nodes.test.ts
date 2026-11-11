import { describe, expect, test } from "bun:test";
import type { FlowNode } from "../flow";
import { withOutputSchema } from "./nodes";

describe("withOutputSchema", () => {
	const at = { x: 0, y: 0 };
	const output = { type: "object" };
	const inferred = {
		id: "check",
		type: "command",
		position: at,
		command: "true",
		stdout: "text",
		output,
		outputInferred: true,
	} as FlowNode;

	test("a person's schema counts as confirmed: the inferred mark goes", () => {
		const next = withOutputSchema(inferred, { type: "array" });
		expect(next).toMatchObject({ output: { type: "array" } });
		expect(next).not.toHaveProperty("outputInferred");
	});

	test("the node's own schema confirms it as it is", () => {
		const next = withOutputSchema(inferred, output);
		expect(next).toMatchObject({ output });
		expect(next).not.toHaveProperty("outputInferred");
	});

	test("no schema removes it, but a Value keeps its own", () => {
		expect(withOutputSchema(inferred, undefined)).not.toHaveProperty("output");
		const value = {
			id: "v",
			type: "value",
			position: at,
			by: "rule",
			expression: "1",
			output,
			outputInferred: true,
		} as FlowNode;
		expect(withOutputSchema(value, undefined)).toEqual({
			id: "v",
			type: "value",
			position: at,
			by: "rule",
			expression: "1",
			output,
		});
	});

	test("a node type without an output schema stays as it is", () => {
		const end = { id: "end", type: "end", position: at } as FlowNode;
		expect(withOutputSchema(end, output)).toBe(end);
	});
});
