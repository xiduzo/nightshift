import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { starterList } from "./starters";

type StarterSource = {
	inputs: { name: string; required?: boolean; default?: string }[];
	nodes: {
		type: string;
		flow?: string;
		clis?: string[];
		connections?: string[];
	}[];
};

const source = (name: string): StarterSource =>
	starterList().find((starter) => starter.name === name)
		?.source as StarterSource;

/** The flows of this folder that a starter's nodes call, kits apart. */
function calls(flow: StarterSource): string[] {
	return flow.nodes
		.filter((node) => node.type === "call" && node.flow)
		.map((node) => node.flow as string)
		.filter((flow) => !flow.startsWith("kit:"));
}

describe("the starters", () => {
	test("each file in the folder is a starter, under its file name", () => {
		const files = readdirSync(join(import.meta.dir, "flows"))
			.filter((name) => name.endsWith(".json"))
			.map((name) => name.slice(0, -".json".length))
			.sort();
		expect(
			starterList()
				.map((starter) => starter.name)
				.sort(),
		).toEqual(files);
	});

	test("a starter comes after the flows it calls", () => {
		const seen = new Set<string>();
		for (const { name } of starterList()) {
			for (const called of calls(source(name))) {
				expect(seen.has(called), `${name} calls ${called}`).toBe(true);
			}
			seen.add(name);
		}
	});

	test("a helper is part of a listed starter, which calls it", () => {
		const helpers = starterList().filter((starter) => starter.partOf);
		expect(helpers.map((helper) => [helper.name, helper.partOf])).toEqual([
			["build-task", "plan-and-build"],
			["edit-file", "per-file"],
		]);
		for (const helper of helpers) {
			const parent = starterList().find(
				(starter) => starter.name === helper.partOf,
			);
			expect(parent, helper.name).toBeDefined();
			expect(parent?.partOf, helper.name).toBeUndefined();
			expect(calls(source(helper.partOf as string))).toContain(helper.name);
		}
	});

	test("only its parent calls a helper", () => {
		for (const { name } of starterList()) {
			for (const called of calls(source(name))) {
				const helper = starterList().find((starter) => starter.name === called);
				if (helper?.partOf) expect(helper.partOf, called).toBe(name);
			}
		}
	});

	test("it fits any project: the person gives every input, as no default fits all", () => {
		for (const { name } of starterList()) {
			for (const input of source(name).inputs) {
				const label = `${name}: ${input.name}`;
				expect(input.default, label).toBeUndefined();
				expect(input.required, label).toBe(true);
			}
		}
	});

	test("it needs one agent login only: no gh, other CLI tool, MCP server or secret", () => {
		for (const { name } of starterList()) {
			const flow = source(name);
			const text = JSON.stringify(flow);
			expect(text, name).not.toMatch(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/);
			expect(text, name).not.toMatch(/\bgh\b/);
			for (const node of flow.nodes) {
				expect(node.type, name).not.toBe("tool");
				expect(node.clis ?? [], name).toEqual([]);
				expect(node.connections ?? [], name).toEqual([]);
			}
		}
	});
});
