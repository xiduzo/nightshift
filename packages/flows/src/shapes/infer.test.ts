import { describe, expect, test } from "bun:test";
import { schemaAt } from "./at";
import {
	INFER_MAX_DEPTH,
	INFER_MAX_PROPERTIES,
	inferOutputType,
	inferSchema,
} from "./infer";
import { fromJsonSchema } from "./shape";

describe("inferSchema", () => {
	test("gives the type of each value, with whole numbers apart", () => {
		expect(inferSchema("a")).toEqual({ type: "string" });
		expect(inferSchema(3)).toEqual({ type: "integer" });
		expect(inferSchema(0.5)).toEqual({ type: "number" });
		expect(inferSchema(true)).toEqual({ type: "boolean" });
		expect(inferSchema(null)).toEqual({ type: "null" });
	});

	test("an object lists its keys, and a list the shape its items share", () => {
		const schema = inferSchema({
			title: "Plan",
			tasks: [
				{ id: "a", size: 1 },
				{ id: "b", size: 2.5, done: true },
			],
		});
		expect(schema).toEqual({
			type: "object",
			properties: {
				title: { type: "string" },
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							size: { type: "number" },
							done: { type: "boolean" },
						},
					},
				},
			},
		});
		// The shape model shows it, and a template path reads into it.
		expect(fromJsonSchema(schema)).not.toBeNull();
		expect(schemaAt(schema, ["tasks", "0", "done"])).toEqual({
			kind: "found",
			schema: { type: "boolean" },
		});
	});

	test("items of different types, and an empty list, are open", () => {
		expect(inferSchema([1, "a"])).toEqual({ type: "array" });
		expect(inferSchema([])).toEqual({ type: "array" });
		expect(schemaAt(inferSchema([1, "a"]), ["0", "x"])).toEqual({
			kind: "open",
		});
	});

	test("stops at its depth: deeper is open", () => {
		let value: unknown = "deep";
		for (let i = 0; i < INFER_MAX_DEPTH + 2; i++) value = { next: value };
		const path = Array.from({ length: INFER_MAX_DEPTH + 2 }, () => "next");
		expect(schemaAt(inferSchema(value), path)).toEqual({ kind: "open" });
		expect(
			schemaAt(inferSchema(value), path.slice(0, INFER_MAX_DEPTH - 1)),
		).toMatchObject({ kind: "found", schema: { type: "object" } });
	});

	test("stops at its number of properties: a bigger object is open", () => {
		const big = Object.fromEntries(
			Array.from({ length: INFER_MAX_PROPERTIES + 1 }, (_, i) => [`k${i}`, i]),
		);
		expect(inferSchema(big)).toEqual({ type: "object" });
		expect(inferSchema({ small: { a: 1 }, big })).toEqual({
			type: "object",
			properties: {
				small: { type: "object", properties: { a: { type: "integer" } } },
				big: { type: "object" },
			},
		});
	});
});

describe("inferOutputType", () => {
	test("a value gives the type of a flow output, JSON with its shape", () => {
		expect(inferOutputType("hi")).toEqual({ type: "text" });
		expect(inferOutputType(3.5)).toEqual({ type: "number" });
		expect(inferOutputType(false)).toEqual({ type: "boolean" });
		expect(inferOutputType({ tasks: ["a"] })).toEqual({
			type: "json",
			schema: {
				type: "object",
				properties: { tasks: { type: "array", items: { type: "string" } } },
			},
		});
		expect(inferOutputType([])).toEqual({
			type: "json",
			schema: { type: "array" },
		});
	});

	test("null says nothing", () => {
		expect(inferOutputType(null)).toBeNull();
		expect(inferOutputType(undefined)).toBeNull();
	});
});
