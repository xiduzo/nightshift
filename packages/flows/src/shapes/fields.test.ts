import { describe, expect, test } from "bun:test";
import {
	type Flow,
	type FlowNode,
	type FlowNodeType,
	nodeOutputFields,
	outputFieldsByType,
} from "../flow";
import {
	flowOutputShape,
	inputShape,
	mainOutputField,
	OUTPUT_FIELD_SHAPES,
	outputFieldShape,
	typedOutput,
} from "./fields";

const at = { x: 0, y: 0 };

describe("output field shapes", () => {
	test("every output field of every node type has a shape", () => {
		for (const type of Object.keys(outputFieldsByType) as FlowNodeType[]) {
			const shapes: Record<string, unknown> = OUTPUT_FIELD_SHAPES[type];
			expect(Object.keys(shapes).sort(), type).toEqual(
				[...outputFieldsByType[type]].sort(),
			);
		}
	});

	test("a node's own output schema types its data", () => {
		const output = {
			type: "object",
			properties: { tests: { type: "integer" } },
		};
		const check: FlowNode = {
			id: "check",
			type: "command",
			position: at,
			command: "make test",
			stdout: "json",
			output,
		};
		expect(outputFieldShape(check, "data")).toBe(output);
		expect(outputFieldShape(check, "exit_code")).toEqual({ type: "integer" });
		expect(outputFieldShape(check, "nope")).toBeUndefined();
	});

	test("typedOutput: the schema, the field it types, and whether Night Shift inferred it", () => {
		const output = { type: "object" };
		const node = (fields: Record<string, unknown>) =>
			({ id: "n", position: at, ...fields }) as FlowNode;
		expect(typedOutput(node({ type: "command", command: "x" }))).toEqual({
			field: "data",
			schema: undefined,
			inferred: false,
		});
		expect(
			typedOutput(node({ type: "tool", output, outputInferred: true })),
		).toEqual({ field: "data", schema: output, inferred: true });
		expect(typedOutput(node({ type: "agent", output }))).toMatchObject({
			inferred: false,
		});
		expect(typedOutput(node({ type: "end" }))).toBeNull();
	});

	test("a Call node reads the shapes of the flow it calls, and with each its results", () => {
		const called = {
			outputs: [
				{ name: "count", value: "{{n.data.count}}", type: "number" },
				{ name: "raw", value: "{{n.data}}" },
			],
		} as Pick<Flow, "outputs"> as Flow;
		const call: FlowNode = {
			id: "sub",
			type: "call",
			position: at,
			flow: "count-things",
			inputs: {},
		};
		for (const field of nodeOutputFields(call, called)) {
			expect(outputFieldShape(call, field, called), field).toBeDefined();
		}
		expect(outputFieldShape(call, "count", called)).toEqual({ type: "number" });
		expect(outputFieldShape(call, "raw", called)).toEqual({});
		const each = { ...call, each: { source: { kind: "json", value: "[]" } } };
		expect(outputFieldShape(each as FlowNode, "results")).toMatchObject({
			type: "array",
		});
	});

	test("flow outputs and inputs take the shape of their type", () => {
		expect(
			flowOutputShape({
				name: "plan",
				value: "{{p.data}}",
				type: "json",
				schema: { type: "array" },
			}),
		).toEqual({ type: "array" });
		expect(flowOutputShape({ name: "n", value: "1", type: "number" })).toEqual({
			type: "number",
		});
		expect(
			inputShape({ name: "size", type: "choice", options: ["s", "m"] }),
		).toEqual({ type: "string", enum: ["s", "m"] });
		expect(inputShape({ name: "item", type: "json" })).toEqual({});
	});
});

describe("mainOutputField", () => {
	const node = (fields: Record<string, unknown>) =>
		({ id: "n", position: at, ...fields }) as FlowNode;

	test("a node with data gives the field its own schema types", () => {
		expect(mainOutputField(node({ type: "value", by: "rule" }))).toBe("data");
		expect(
			mainOutputField(node({ type: "web-request", method: "GET", url: "" })),
		).toBe("body");
		expect(
			mainOutputField(
				node({ type: "agent", prompt: "", output: { type: "object" } }),
			),
		).toBe("data");
		expect(
			mainOutputField(node({ type: "command", command: "", stdout: "json" })),
		).toBe("data");
		expect(
			mainOutputField(
				node({ type: "convert", from: "csv", to: "json", value: "" }),
			),
		).toBe("data");
	});

	test("a node without data gives the field that says the most", () => {
		expect(mainOutputField(node({ type: "agent", prompt: "" }))).toBe("output");
		expect(
			mainOutputField(node({ type: "command", command: "ls", stdout: "text" })),
		).toBe("log_tail");
		expect(
			mainOutputField(
				node({ type: "convert", from: "json", to: "csv", value: "" }),
			),
		).toBe("text");
		expect(mainOutputField(node({ type: "decision", by: "person" }))).toBe(
			"note",
		);
		expect(mainOutputField(node({ type: "end", status: "done" }))).toBe(
			"message",
		);
		expect(mainOutputField(node({ type: "lease", name: "deploy" }))).toBe(
			"holder",
		);
		expect(
			mainOutputField(
				node({ type: "wait", until: { kind: "duration", minutes: 5 } }),
			),
		).toBe("waited_minutes");
		expect(
			mainOutputField(node({ type: "wait", until: { kind: "url", url: "" } })),
		).toBe("data");
	});
});
