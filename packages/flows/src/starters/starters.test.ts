import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { FLOW_VERSION, type Flow } from "../flow";
import { parseFlow } from "../validate";
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

	test("it fits any project: no default names a language or its tools, and an input without one is required", () => {
		const specific =
			/\b(bun|npm|pnpm|yarn|npx|node|deno|pytest|python|pip|cargo|go|mvn|gradle|make|dotnet)\b|\.(ts|tsx|js|jsx|py|rb|go|rs|java|kt|cs)\b/;
		for (const { name } of starterList()) {
			for (const input of source(name).inputs) {
				const label = `${name}: ${input.name}`;
				if (input.default === undefined)
					expect(input.required, label).toBe(true);
				else expect(String(input.default), label).not.toMatch(specific);
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

	test("each starter comes to the current format with no errors", () => {
		const flows: Record<string, Flow | null> = Object.fromEntries(
			starterList().map(({ name, source }) => [name, parseFlow(source).flow]),
		);
		for (const { name, source } of starterList()) {
			const { flow, issues } = parseFlow(source, { flows, name });
			expect({
				name,
				version: flow?.version,
				errors: issues.filter((issue) => issue.severity === "error"),
			}).toEqual({ name, version: FLOW_VERSION, errors: [] });
		}
	});

	test("a starter needs Claude Code only: no secret, connection, profile, device or decision model", () => {
		for (const { name, source } of starterList()) {
			const nodes = parseFlow(source).flow?.nodes ?? [];
			for (const node of nodes) {
				const tiers = "cascade" in node ? (node.cascade ?? []) : [];
				for (const part of [node, ...tiers] as Record<string, unknown>[]) {
					expect({
						name,
						node: node.id,
						secrets: part.secrets,
						connections: part.connections,
						profile: part.profile,
						device: part.device,
						model: part.by === "model",
						harness: part.harness ?? "claude-code",
					}).toEqual({
						name,
						node: node.id,
						secrets: undefined,
						connections: undefined,
						profile: undefined,
						device: undefined,
						model: false,
						harness: "claude-code",
					});
				}
			}
		}
	});
});
