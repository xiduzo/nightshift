import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

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
});
