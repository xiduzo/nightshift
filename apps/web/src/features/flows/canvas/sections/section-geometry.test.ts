import { describe, expect, test } from "bun:test";
import {
	commandNode,
	FLOW_VERSION,
	type Flow,
	type FlowSection,
} from "@nightshift/flows";
import {
	boxPosition,
	FRAME_PADDING,
	frameHeader,
	frameRect,
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

describe("frames", () => {
	test("a frame is its members' box, padded, with a header on top", () => {
		expect(membersBounds(flow, ["a", "b"], sizes)).toEqual({
			x: 0,
			y: 0,
			width: 656,
			height: 220,
		});
		const header = frameHeader(section);
		expect(frameRect(flow, section, sizes)).toEqual({
			x: -FRAME_PADDING,
			y: -FRAME_PADDING - header,
			width: 656 + 2 * FRAME_PADDING,
			height: 220 + 2 * FRAME_PADDING + header,
		});
	});

	test("a description makes the header taller", () => {
		expect(frameHeader({ description: "Checks the work" })).toBeGreaterThan(
			frameHeader({}),
		);
		expect(frameHeader({ description: "  " })).toBe(frameHeader({}));
	});

	test("unmeasured nodes count with a typical size, unknown ids not at all", () => {
		expect(membersBounds(flow, ["a", "zz"])).toEqual({
			x: 0,
			y: 0,
			width: 256,
			height: 160,
		});
		expect(membersBounds(flow, ["zz"])).toBeNull();
		expect(frameRect(flow, { ...section, nodes: [] })).toBeNull();
	});

	test("the frame follows a member that moves", () => {
		const moved = {
			...flow,
			nodes: flow.nodes.map((node) =>
				node.id === "b" ? { ...node, position: { x: 400, y: 400 } } : node,
			),
		};
		const before = frameRect(flow, section, sizes);
		const after = frameRect(moved, section, sizes);
		expect(after?.x).toBe(before?.x);
		expect(after?.height).toBe((before?.height ?? 0) + 320);
	});

	test("a folded box sits at the top-left corner of its members", () => {
		expect(boxPosition(flow, section)).toEqual({ x: 0, y: 0 });
	});
});

describe("dragging a Section", () => {
	test("dragging the frame moves its members by as much, and no other node", () => {
		const frame = frameRect(flow, section, sizes);
		if (!frame) throw new Error("no frame");
		const delta = sectionDragDelta(
			flow,
			section,
			{ x: frame.x + 40, y: frame.y - 16 },
			{ sizes, folded: false },
		);
		expect(delta).toEqual({ x: 40, y: -16 });
		const moved = moveSection(flow, section, delta ?? { x: 0, y: 0 });
		expect(moved.nodes.map((node) => node.position)).toEqual([
			{ x: 40, y: -16 },
			{ x: 440, y: 64 },
			{ x: 1000, y: 1000 },
		]);
		// The frame lands where it was dropped.
		expect(frameRect(moved, section, sizes)).toEqual(
			expect.objectContaining({ x: frame.x + 40, y: frame.y - 16 }),
		);
	});

	test("dragging a folded box moves its members from their top-left corner", () => {
		expect(
			sectionDragDelta(flow, section, { x: 8, y: 24 }, { folded: true }),
		).toEqual({ x: 8, y: 24 });
	});

	test("no move keeps the flow", () => {
		expect(moveSection(flow, section, { x: 0, y: 0 })).toBe(flow);
	});
});
