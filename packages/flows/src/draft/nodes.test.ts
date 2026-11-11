import { describe, expect, test } from "bun:test";
import type { FlowNode } from "../flow";
import type { ToolNode } from "../nodes";
import { withOutputSchema, withTool } from "./nodes";

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

describe("withTool", () => {
	const tool: ToolNode = {
		id: "lookup",
		type: "tool",
		position: { x: 0, y: 0 },
		connection: "docs",
		tool: "",
		arguments: {},
	};
	const shape = { type: "object", properties: { items: { type: "array" } } };

	test("the tool's own shape of its answer becomes the node's, marked inferred", () => {
		expect(withTool(tool, "search", shape)).toEqual({
			...tool,
			tool: "search",
			output: shape,
			outputInferred: true,
		});
	});

	test("another tool drops an inferred shape, and a person's shape stays", () => {
		const inferred = withTool(tool, "search", shape);
		expect(withTool(inferred, "fetch")).toEqual({ ...tool, tool: "fetch" });
		const written = { ...tool, output: { type: "array" } };
		expect(withTool(written, "search", shape)).toEqual({
			...written,
			tool: "search",
		});
	});
});
