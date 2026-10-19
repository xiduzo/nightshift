import { describe, expect, test } from "bun:test";

import {
	emptyShape,
	fieldNameProblem,
	fromJsonSchema,
	shapeIsValid,
	toJsonSchema,
} from "./schema-builder";

describe("schema builder", () => {
	test("round-trips a nested object, keeping order, required and descriptions", () => {
		const schema = {
			type: "object",
			properties: {
				title: { type: "string", description: "The title." },
				size: { type: "string", enum: ["small", "large"] },
				count: { type: "integer" },
				score: { type: "number" },
				done: { type: "boolean" },
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: { id: { type: "string" } },
						required: ["id"],
					},
				},
			},
			required: ["title", "tasks"],
			description: "A plan.",
		};
		const shape = fromJsonSchema(schema);
		if (shape?.kind !== "object") throw new Error("not an object");
		expect(toJsonSchema(shape)).toEqual(schema);
		expect(shape.fields.map((f) => f.name)).toEqual([
			"title",
			"size",
			"count",
			"score",
			"done",
			"tasks",
		]);
	});

	test("round-trips a list at the root", () => {
		const schema = { type: "array", items: { type: "string" } };
		const shape = fromJsonSchema(schema);
		if (!shape) throw new Error("not shown");
		expect(toJsonSchema(shape)).toEqual(schema);
	});

	test("reads an object without a type from its properties", () => {
		expect(fromJsonSchema({ properties: { a: { type: "string" } } })).toEqual({
			kind: "object",
			fields: [{ name: "a", required: false, shape: { kind: "text" } }],
		});
	});

	test("returns null for what it cannot show", () => {
		expect(fromJsonSchema({ anyOf: [{ type: "string" }] })).toBeNull();
		expect(fromJsonSchema({ $ref: "#/x" })).toBeNull();
		expect(fromJsonSchema({ type: "string", minLength: 1 })).toBeNull();
		expect(fromJsonSchema({ type: "array" })).toBeNull();
		expect(fromJsonSchema({ type: ["string", "null"] })).toBeNull();
		expect(
			fromJsonSchema({ type: "object", properties: { a: { not: {} } } }),
		).toBeNull();
		expect(
			fromJsonSchema({ type: "object", properties: {}, required: ["x"] }),
		).toBeNull();
		expect(fromJsonSchema({ type: "string", enum: [1, 2] })).toBeNull();
		expect(fromJsonSchema("nope")).toBeNull();
	});

	test("emptyShape keeps the description", () => {
		expect(emptyShape("list", "Items.")).toEqual({
			kind: "list",
			items: { kind: "text" },
			description: "Items.",
		});
	});

	test("field names are identifiers, unique within an object", () => {
		expect(fieldNameProblem("tasks_2", [])).toBeNull();
		expect(fieldNameProblem("", [])).not.toBeNull();
		expect(fieldNameProblem("2x", [])).not.toBeNull();
		expect(fieldNameProblem("a-b", [])).not.toBeNull();
		expect(fieldNameProblem("a", ["a"])).not.toBeNull();
		expect(
			shapeIsValid({
				kind: "object",
				fields: [
					{ name: "a", required: false, shape: { kind: "text" } },
					{ name: "a", required: false, shape: { kind: "text" } },
				],
			}),
		).toBe(false);
		expect(
			shapeIsValid({ kind: "list", items: { kind: "choice", values: [] } }),
		).toBe(false);
	});
});
