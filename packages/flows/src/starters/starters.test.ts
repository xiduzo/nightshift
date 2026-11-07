import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { FLOW_VERSION, type Flow } from "../flow";
import { parseFlow } from "../validate";
import { starterList } from "./starters";

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
		for (const { name, source } of starterList()) {
			const nodes = (source as { nodes: { type: string; flow?: string }[] })
				.nodes;
			for (const node of nodes) {
				if (
					node.type === "call" &&
					node.flow &&
					!node.flow.startsWith("kit:")
				) {
					expect(seen.has(node.flow)).toBe(true);
				}
			}
			seen.add(name);
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
