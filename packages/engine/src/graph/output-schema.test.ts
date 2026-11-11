import { describe, expect, test } from "bun:test";
import type { FlowNode } from "@nightshift/flows";
import { dataProblem, outputVerdict, schemaProblem } from "./output-schema";

describe("output schemas", () => {
	test("a file shape is a string of the format file", () => {
		const schema = {
			type: "object",
			properties: { report: { type: "string", format: "file" } },
		};
		expect(schemaProblem(schema)).toBeNull();
		expect(dataProblem(schema, { report: "report.md" })).toBeNull();
		expect(dataProblem(schema, { report: 3 })).toBe(
			"data/report must be string",
		);
	});
});

describe("outputVerdict", () => {
	const schema = {
		type: "object",
		properties: { tests: { type: "integer" } },
		required: ["tests"],
	};
	const node = (type: string, fields: Record<string, unknown> = {}) =>
		({ id: "n", type, position: { x: 0, y: 0 }, ...fields }) as FlowNode;

	test("data that fits, or a node without a schema, holds", () => {
		expect(
			outputVerdict(node("command", { output: schema }), { tests: 3 }),
		).toEqual({ kind: "holds" });
		expect(outputVerdict(node("command"), { tests: "three" })).toEqual({
			kind: "holds",
		});
		// A node type without an output schema has nothing to check.
		expect(outputVerdict(node("end", { output: schema }), 1)).toEqual({
			kind: "holds",
		});
	});

	test("a schema a person wrote: a Do node errors, a Shape node fails", () => {
		for (const type of ["agent", "command", "tool"]) {
			expect(
				outputVerdict(node(type, { output: schema }), { tests: "three" }),
			).toMatchObject({ kind: "broken", outcome: "error" });
		}
		expect(
			outputVerdict(node("value", { output: schema }), { tests: "three" }),
		).toEqual({
			kind: "broken",
			outcome: "fail",
			message:
				"The value does not match the output schema: data/tests must be integer.",
		});
	});

	test("a schema Night Shift inferred only warns", () => {
		const verdict = outputVerdict(
			node("command", { output: schema, outputInferred: true }),
			{ tests: "three" },
		);
		expect(verdict).toEqual({
			kind: "warning",
			message:
				"The command's data does not match the output schema: data/tests must be integer. Night Shift took this shape from an earlier run. Confirm it or change it in the editor.",
		});
	});

	test("a schema that is not valid errors on any node, inferred or not", () => {
		const invalid = { type: "nope" };
		for (const fields of [{}, { outputInferred: true }]) {
			const verdict = outputVerdict(
				node("value", { output: invalid, ...fields }),
				1,
			);
			expect(verdict).toMatchObject({ kind: "broken", outcome: "error" });
		}
	});

	test("no data does not fit a schema", () => {
		expect(outputVerdict(node("agent", { output: schema }), undefined)).toEqual(
			{
				kind: "broken",
				outcome: "error",
				message:
					"The agent's step report has no data, but this node has an output schema.",
			},
		);
	});

	test("outcome and scores are allowed beside the schema's fields", () => {
		const closed = { ...schema, additionalProperties: false };
		const data = { tests: 3, outcome: "pass", scores: { found: 1 } };
		expect(outputVerdict(node("command", { output: closed }), data)).toEqual({
			kind: "holds",
		});
		// A schema that names one holds it to its own shape.
		const named = {
			...closed,
			properties: { ...schema.properties, outcome: { type: "integer" } },
		};
		expect(
			outputVerdict(node("command", { output: named }), data),
		).toMatchObject({ kind: "broken" });
	});
});
