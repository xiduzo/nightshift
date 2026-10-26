import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import * as flows from "../index";

/**
 * The schemas of the package, as JSON Schema. A move of a schema between
 * files must not change what it accepts, its defaults or its error
 * messages: the snapshots pin every schema a source file of the package
 * exports, on the package root or not.
 */
const src = join(import.meta.dir, "..");
const declared = new Map<string, z.ZodType>();
for (const file of new Bun.Glob("**/*.ts").scanSync(src)) {
	if (/(\.test\.ts$|(^|\/)(testing|fixtures)\/)/.test(file)) continue;
	const module = (await import(join(src, file))) as Record<string, unknown>;
	for (const [name, value] of Object.entries(module)) {
		if (!(value instanceof z.ZodType)) continue;
		const known = declared.get(name);
		if (known && known !== value)
			throw new Error(`Two schemas are named ${name}: rename one.`);
		declared.set(name, value);
	}
}
const schemas = [...declared].sort(([a], [b]) => a.localeCompare(b));

function jsonSchemas(schema: z.ZodType) {
	return {
		input: z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
		output: z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }),
	};
}

describe("published schemas", () => {
	test("the flow document is one of them", () => {
		expect(schemas.map(([name]) => name)).toContain("flowSchema");
		expect(flows.flowSchema).toBe(declared.get("flowSchema") as never);
	});

	// The files a person writes, in full.
	for (const name of [
		"flowSchema",
		"schedulesFileSchema",
		"agentProfileSchema",
		"profileSchema",
		"customAgentSchema",
	]) {
		test(`${name} as JSON Schema`, () => {
			const schema = schemas.find(([key]) => key === name)?.[1];
			if (schema === undefined) throw new Error(`${name} is not declared`);
			expect(jsonSchemas(schema)).toMatchSnapshot();
		});
	}

	// Every other schema, by a hash: the part of the document it is.
	test("every published schema as a JSON Schema hash", () => {
		expect(
			Object.fromEntries(
				schemas.map(([name, schema]) => [
					name,
					new Bun.CryptoHasher("sha256")
						.update(JSON.stringify(jsonSchemas(schema)))
						.digest("hex"),
				]),
			),
		).toMatchSnapshot();
	});

	test("the version 1 fixtures parse to the same flows", () => {
		const dir = join(import.meta.dir, "fixtures", "v1-rpgdotexe");
		const parsed = ["night", "feature", "trace"].map((name) =>
			flows.parseFlow(
				JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")),
			),
		);
		expect(parsed).toMatchSnapshot();
	});

	test("a flow that is not valid gives the same schema issues", () => {
		expect(
			flows.parseFlow({
				version: 6,
				start: "Bad",
				nodes: [
					{ id: "a", type: "agent", position: { x: 0, y: 0 }, prompt: 1 },
					{ id: "w", type: "wait", position: { x: 0, y: 0 }, until: {} },
					{ id: "c", type: "call", position: { x: 0, y: 0 }, flow: "Up" },
				],
				edges: [{ id: "e", from: "a", outcome: "OK", to: "w", max: 0 }],
			}),
		).toMatchSnapshot();
	});
});
