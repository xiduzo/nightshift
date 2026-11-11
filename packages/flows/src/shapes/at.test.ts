import { describe, expect, test } from "bun:test";
import { schemaAt } from "./at";

const plan = {
	type: "object",
	properties: {
		title: { type: "string" },
		tasks: {
			type: "array",
			items: {
				type: "object",
				properties: { id: { type: "string" }, size: { type: "integer" } },
			},
		},
		extra: { type: "object" },
	},
};

describe("schemaAt", () => {
	test("finds what a path reads: a key, an index into a list, a key of an item", () => {
		expect(schemaAt(plan, [])).toEqual({ kind: "found", schema: plan });
		expect(schemaAt(plan, ["title"])).toEqual({
			kind: "found",
			schema: { type: "string" },
		});
		expect(schemaAt(plan, ["tasks", "0", "size"])).toEqual({
			kind: "found",
			schema: { type: "integer" },
		});
	});

	test("a key the shape lacks is missing, with the keys it has there", () => {
		expect(schemaAt(plan, ["taks"])).toEqual({
			kind: "missing",
			index: 0,
			keys: ["title", "tasks", "extra"],
		});
		expect(schemaAt(plan, ["tasks", "0", "name"])).toEqual({
			kind: "missing",
			index: 2,
			keys: ["id", "size"],
		});
	});

	test("text takes no path, and a list takes only an index", () => {
		expect(schemaAt(plan, ["title", "x"])).toMatchObject({
			kind: "missing",
			index: 1,
			keys: [],
		});
		expect(schemaAt(plan, ["tasks", "first"])).toMatchObject({
			kind: "missing",
			index: 1,
		});
	});

	test("a shape that does not say is open: any path passes", () => {
		for (const schema of [
			{},
			{ type: "object" },
			{ anyOf: [{ type: "string" }, { type: "object" }] },
			{ $ref: "#/defs/x" },
			{ type: ["object", "null"] },
			"nope",
		]) {
			expect(schemaAt(schema, ["a", "b"])).toEqual({ kind: "open" });
		}
		expect(schemaAt({ type: "array" }, ["0", "b"])).toEqual({ kind: "open" });
		expect(schemaAt(plan, ["extra", "anything", "deeper"])).toEqual({
			kind: "open",
		});
	});

	test("additionalProperties gives the shape of any other key", () => {
		const scores = {
			type: "object",
			additionalProperties: { type: "number" },
		};
		expect(schemaAt(scores, ["found"])).toEqual({
			kind: "found",
			schema: { type: "number" },
		});
	});
});
