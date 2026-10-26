import { describe, expect, test } from "bun:test";
import { type Flow, flowSchema } from "../document";
import {
	nodesWithin,
	parentSection,
	sectionLevel,
	sectionPath,
	sectionsWithin,
	topSections,
} from "./tree";

const command = (id: string) => ({
	id,
	type: "command" as const,
	position: { x: 0, y: 0 },
	command: "true",
});

/**
 * a → b → c → d → e. Outer holds b and Inner; Inner holds c and d.
 */
const nested: Flow = flowSchema.parse({
	version: 5,
	start: "a",
	nodes: ["a", "b", "c", "d", "e"].map(command),
	edges: [
		{ id: "ab", from: "a", outcome: "pass", to: "b" },
		{ id: "bc", from: "b", outcome: "pass", to: "c" },
		{ id: "cd", from: "c", outcome: "pass", to: "d" },
		{ id: "de", from: "d", outcome: "pass", to: "e" },
	],
	sections: [
		{ id: "inner", label: "Inner", nodes: ["d", "c"] },
		{ id: "outer", label: "Outer", nodes: ["b"], sections: ["inner"] },
	],
});

describe("the nesting of Sections", () => {
	test("reads parents, paths and the Sections on top", () => {
		expect(parentSection(nested, "inner")?.id).toBe("outer");
		expect(parentSection(nested, "outer")).toBeUndefined();
		expect(topSections(nested).map((s) => s.id)).toEqual(["outer"]);
		expect(sectionPath(nested, "inner").map((s) => s.id)).toEqual([
			"outer",
			"inner",
		]);
		expect(sectionPath(nested, "gone")).toEqual([]);
	});

	test("every node within a Section, in flow order", () => {
		const outer = nested.sections?.[1];
		if (!outer) throw new Error("no outer");
		expect(nodesWithin(nested, outer)).toEqual(["b", "c", "d"]);
		expect(sectionsWithin(nested, outer).map((s) => s.id)).toEqual(["inner"]);
	});

	test("never loops on a Section inside itself", () => {
		const loop: Flow = {
			...nested,
			sections: [
				{ id: "x", label: "X", nodes: ["b"], sections: ["y"] },
				{ id: "y", label: "Y", nodes: ["c"], sections: ["x"] },
			],
		};
		const x = loop.sections?.[0];
		if (!x) throw new Error("no x");
		expect(nodesWithin(loop, x)).toEqual(["b", "c"]);
		expect(sectionPath(loop, "x").map((s) => s.id)).toEqual(["y", "x"]);
	});
});

describe("sectionLevel", () => {
	test("the whole flow shows the Sections on top, each with all its nodes", () => {
		const level = sectionLevel(nested, null);
		expect(level.nodes).toHaveLength(5);
		expect(level.sections).toEqual([
			{ id: "outer", label: "Outer", nodes: ["b", "c", "d"] },
		]);
	});

	test("inside a Section: its nodes, their edges, and the Sections directly in it", () => {
		const level = sectionLevel(nested, "outer");
		expect(level.nodes.map((node) => node.id)).toEqual(["b", "c", "d"]);
		expect(level.edges.map((edge) => edge.id)).toEqual(["bc", "cd"]);
		expect(level.sections).toEqual([
			{ id: "inner", label: "Inner", nodes: ["c", "d"] },
		]);
		expect(level.start).toBe("a");
		const inner = sectionLevel(nested, "inner");
		expect(inner.nodes.map((node) => node.id)).toEqual(["c", "d"]);
		expect(inner.sections).toBeUndefined();
	});
});
