import { describe, expect, test } from "bun:test";
import {
	commandNode,
	FLOW_VERSION,
	type Flow,
	removeSection,
} from "@nightshift/flows";
import { restoreSection, undoSubflow } from "./section-edits";

const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "a",
	nodes: ["a", "b", "c", "d"].map((id) => commandNode(id, { x: 0, y: 0 })),
	edges: [],
	sections: [
		{ id: "one", label: "One", nodes: ["a", "b"] },
		{ id: "two", label: "Two", color: "blue", nodes: ["c"] },
	],
};

describe("restoreSection", () => {
	test("puts a removed Section back in its place", () => {
		const section = flow.sections?.[0];
		if (!section) throw new Error("no section");
		expect(restoreSection(removeSection(flow, "one"), section, 0)).toEqual(
			flow,
		);
	});

	test("leaves out nodes that went or joined another Section", () => {
		const section = flow.sections?.[0];
		if (!section) throw new Error("no section");
		const changed: Flow = {
			...removeSection(flow, "one"),
			nodes: flow.nodes.filter((node) => node.id !== "a"),
		};
		expect(restoreSection(changed, section, 0).sections?.[0]).toEqual({
			...section,
			nodes: ["b"],
		});
		const taken: Flow = {
			...changed,
			sections: [{ id: "two", label: "Two", nodes: ["b", "c"] }],
		};
		expect(restoreSection(taken, section, 0)).toBe(taken);
	});

	test("does nothing when the Section is back already", () => {
		const section = flow.sections?.[1];
		if (!section) throw new Error("no section");
		expect(restoreSection(flow, section, 1)).toBe(flow);
	});
});

describe("restoreSection inside a Section", () => {
	const nested: Flow = {
		...flow,
		sections: [
			{ id: "outer", label: "Outer", nodes: ["a"], sections: ["inner"] },
			{ id: "inner", label: "Inner", nodes: ["b", "c"] },
		],
	};

	test("undoes the removal of an inner Section", () => {
		const removed = removeSection(nested, "inner");
		const inner = nested.sections?.[1];
		if (!inner) throw new Error("no inner");
		expect(restoreSection(removed, inner, 1, "outer")).toEqual(nested);
	});

	test("undoes the removal of an outer Section", () => {
		const removed = removeSection(nested, "outer");
		const outer = nested.sections?.[0];
		if (!outer) throw new Error("no outer");
		expect(restoreSection(removed, outer, 0)).toEqual(nested);
	});
});

describe("undoSubflow", () => {
	const caller: Flow = { ...flow, sections: [] };

	test("gives the draft before, while the draft is the one it made", () => {
		expect(undoSubflow(caller, { caller }, flow)).toBe(flow);
	});

	test("gives nothing once the draft changed since", () => {
		const edited: Flow = { ...caller, start: "b" };
		expect(undoSubflow(edited, { caller }, flow)).toBeNull();
	});
});
