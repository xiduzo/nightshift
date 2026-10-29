import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowSection } from "@nightshift/flows";
import { commandNode } from "@nightshift/flows/testing";
import {
	boxPosition,
	membersBounds,
	moveSection,
	sectionDragDelta,
} from "./section-geometry";

const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "a",
	nodes: [
		commandNode("a", { x: 0, y: 0 }),
		commandNode("b", { x: 400, y: 80 }),
		commandNode("c", { x: 1000, y: 1000 }),
	],
	edges: [],
};
const section: FlowSection = { id: "s", label: "S", nodes: ["a", "b"] };
const sizes = {
	a: { width: 256, height: 100 },
	b: { width: 256, height: 140 },
};

describe("the box", () => {
	test("its members' bounds, by their positions and sizes", () => {
		expect(membersBounds(flow, ["a", "b"], sizes)).toEqual({
			x: 0,
			y: 0,
			width: 656,
			height: 220,
		});
	});

	test("unmeasured nodes count with a typical size, unknown ids not at all", () => {
		expect(membersBounds(flow, ["a", "zz"])).toEqual({
			x: 0,
			y: 0,
			width: 256,
			height: 160,
		});
		expect(membersBounds(flow, ["zz"])).toBeNull();
		expect(boxPosition(flow, { ...section, nodes: [] })).toBeNull();
	});

	test("a box sits at the top-left corner of its members", () => {
		expect(boxPosition(flow, section)).toEqual({ x: 0, y: 0 });
	});
});

describe("dragging a Section", () => {
	test("dragging the box moves its members by as much, and no other node", () => {
		const delta = sectionDragDelta(flow, section, { x: 40, y: -16 });
		expect(delta).toEqual({ x: 40, y: -16 });
		const moved = moveSection(flow, section, delta ?? { x: 0, y: 0 });
		expect(moved.nodes.map((node) => node.position)).toEqual([
			{ x: 40, y: -16 },
			{ x: 440, y: 64 },
			{ x: 1000, y: 1000 },
		]);
		// The box lands where it was dropped.
		expect(boxPosition(moved, section)).toEqual({ x: 40, y: -16 });
	});

	test("no move keeps the flow", () => {
		expect(moveSection(flow, section, { x: 0, y: 0 })).toBe(flow);
	});
});
