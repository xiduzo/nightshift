import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { commandNode } from "@nightshift/flows/testing";
import { withNodeChanges } from "./node-moves";

// a → b → c → d → e. Outer holds b and Inner. Inner holds c and d.
const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "a",
	nodes: [
		commandNode("a", { x: 0, y: 0 }),
		commandNode("b", { x: 320, y: 0 }),
		commandNode("c", { x: 640, y: 0 }),
		commandNode("d", { x: 640, y: 240 }),
		commandNode("e", { x: 960, y: 0 }),
	],
	edges: [
		{ id: "a-b", from: "a", outcome: "success", to: "b" },
		{ id: "b-c", from: "b", outcome: "success", to: "c" },
		{ id: "c-d", from: "c", outcome: "success", to: "d" },
		{ id: "d-e", from: "d", outcome: "success", to: "e" },
	],
	sections: [
		{ id: "inner", label: "Inner", nodes: ["c", "d"] },
		{ id: "outer", label: "Outer", nodes: ["b"], sections: ["inner"] },
	],
};

const NONE = new Map<string, { x: number; y: number }>();

/** Where each node of `next` is. */
const places = (next: Flow) =>
	Object.fromEntries(next.nodes.map((node) => [node.id, node.position]));

describe("the flow after one change on the canvas", () => {
	test("moves the nodes that moved", () => {
		const next = withNodeChanges(flow, {
			sectionMoves: NONE,
			moves: [
				{ id: "a", position: { x: 8, y: 16 } },
				{ id: "e", position: { x: 1000, y: 40 } },
			],
			removed: [],
		});
		expect(places(next)).toEqual({
			...places(flow),
			a: { x: 8, y: 16 },
			e: { x: 1000, y: 40 },
		});
	});

	test("a dragged box carries its nodes and those of the Sections inside it", () => {
		// The box of Outer has its top-left corner at b: (320, 0).
		const next = withNodeChanges(flow, {
			sectionMoves: new Map([["outer", { x: 360, y: 20 }]]),
			moves: [],
			removed: [],
		});
		expect(places(next)).toEqual({
			...places(flow),
			b: { x: 360, y: 20 },
			c: { x: 680, y: 20 },
			d: { x: 680, y: 260 },
		});
	});

	test("a node the box carries does not move on its own in the same change", () => {
		const next = withNodeChanges(flow, {
			sectionMoves: new Map([["inner", { x: 600, y: 0 }]]),
			moves: [
				{ id: "c", position: { x: 0, y: 999 } },
				{ id: "a", position: { x: 24, y: 0 } },
			],
			removed: [],
		});
		expect(places(next)).toEqual({
			...places(flow),
			a: { x: 24, y: 0 },
			c: { x: 600, y: 0 },
			d: { x: 600, y: 240 },
		});
	});

	test("a box of a Section the flow does not have moves nothing", () => {
		const next = withNodeChanges(flow, {
			sectionMoves: new Map([["gone", { x: 100, y: 100 }]]),
			moves: [],
			removed: [],
		});
		expect(next).toBe(flow);
	});

	test("removes the nodes that went, with their edges", () => {
		const next = withNodeChanges(flow, {
			sectionMoves: NONE,
			moves: [],
			removed: ["e", "a"],
		});
		expect(next.nodes.map((node) => node.id)).toEqual(["b", "c", "d"]);
		expect(next.edges.map((edge) => edge.id)).toEqual(["b-c", "c-d"]);
	});

	test("no move and no remove leaves the flow as it is", () => {
		expect(
			withNodeChanges(flow, { sectionMoves: NONE, moves: [], removed: [] }),
		).toBe(flow);
	});
});
