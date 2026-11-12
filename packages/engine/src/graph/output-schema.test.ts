import { describe, expect, test } from "bun:test";
import type { FlowNode } from "@nightshift/flows";
import {
	dataProblem,
	flowOutputsVerdict,
	outputVerdict,
	schemaProblem,
} from "./output-schema";

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

describe("flowOutputsVerdict", () => {
	const plan = {
		type: "object",
		properties: { tasks: { type: "array" } },
	};

	test("outputs that fit their types hold, read as the type a person gave", () => {
		expect(
			flowOutputsVerdict(
				{
					outputs: [
						{ name: "count", value: "{{a}}{{b}}", type: "number" },
						{ name: "plan", value: "{{p.data}}", type: "json", schema: plan },
						{
							name: "seen",
							value: "{{s}}{{t}}",
							type: "number",
							inferred: true,
						},
						{ name: "any", value: "{{x.data}}" },
						{ name: "none", value: "{{gone.data}}", type: "boolean" },
					],
				},
				"research",
				{
					count: "12",
					plan: { tasks: [] },
					seen: "4",
					any: { free: true },
					none: null,
				},
			),
		).toEqual({
			// An inferred type gives the value as it came.
			values: {
				count: 12,
				plan: { tasks: [] },
				seen: "4",
				any: { free: true },
				none: null,
			},
			warnings: [],
			broken: null,
		});
	});

	test("an output that does not fit a type a person gave breaks the promise", () => {
		const verdict = flowOutputsVerdict(
			{
				outputs: [
					{ name: "count", value: "{{c.data}}", type: "number" },
					{ name: "plan", value: "{{p.data}}", type: "json", schema: plan },
				],
			},
			"research",
			{ count: "many", plan: { tasks: "none" } },
		);
		expect(verdict.broken).toBe(
			'The output "count" of the flow "research" does not fit its type. A number is needed, and the value is "many".',
		);
		expect(verdict.warnings).toEqual([]);
		expect(
			flowOutputsVerdict(
				{
					outputs: [
						{ name: "plan", value: "{{p.data}}", type: "json", schema: plan },
					],
				},
				"research",
				{ plan: { tasks: "none" } },
			).broken,
		).toBe(
			'The output "plan" of the flow "research" does not fit its type. The value does not match its schema: data/tasks must be array.',
		);
	});

	test("an output that does not fit a type Night Shift inferred warns, and keeps its value", () => {
		expect(
			flowOutputsVerdict(
				{
					outputs: [
						{
							name: "plan",
							value: "{{p.data}}",
							type: "json",
							schema: plan,
							inferred: true,
						},
					],
				},
				"research",
				{ plan: { tasks: "none" } },
			),
		).toEqual({
			values: { plan: { tasks: "none" } },
			warnings: [
				{
					output: "plan",
					message:
						'The output "plan" of the flow "research" does not fit its type. The value does not match its schema: data/tasks must be array. Night Shift took this type from an earlier run. Confirm it or change it in that flow.',
				},
			],
			broken: null,
		});
	});
});
