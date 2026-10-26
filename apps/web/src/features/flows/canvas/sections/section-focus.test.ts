import { describe, expect, test } from "bun:test";
import { commandNode, FLOW_VERSION, type Flow } from "@nightshift/flows";
import {
	closesOnZoomOut,
	handOver,
	opensOnZoomIn,
	sectionPart,
	zoomAfterClose,
} from "./section-focus";

const origin = { x: 0, y: 0 };
const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "a",
	nodes: ["a", "b", "c", "d"].map((id) => commandNode(id, origin)),
	edges: [
		{ id: "a-ok-b", from: "a", outcome: "ok", to: "b" },
		{ id: "b-ok-c", from: "b", outcome: "ok", to: "c" },
		{ id: "c-ok-d", from: "c", outcome: "ok", to: "d" },
		{ id: "c-fail-b", from: "c", outcome: "fail", to: "b" },
	],
	sections: [{ id: "middle", label: "Middle", nodes: ["b", "c"] }],
};
const canvas = { width: 1200, height: 800 };

describe("sectionPart", () => {
	test("keeps the Section's nodes and the edges between them", () => {
		const section = flow.sections?.[0];
		if (!section) throw new Error("no section");
		const part = sectionPart(flow, section);
		expect(part.nodes.map((node) => node.id)).toEqual(["b", "c"]);
		expect(part.edges.map((edge) => edge.id)).toEqual(["b-ok-c", "c-fail-b"]);
		expect(part.sections).toBeUndefined();
		expect(part.start).toBe("a");
	});
});

describe("opensOnZoomIn", () => {
	const box = { width: 256, height: 160 };
	test("opens a box that almost fills the canvas", () => {
		expect(opensOnZoomIn({ box, canvas, zoom: 1, maxZoom: 2 })).toBe(false);
		expect(opensOnZoomIn({ box, canvas, zoom: 3, maxZoom: 5 })).toBe(false);
		expect(opensOnZoomIn({ box, canvas, zoom: 4.5, maxZoom: 5 })).toBe(true);
	});
	test("opens a box once the canvas cannot zoom in further", () => {
		expect(opensOnZoomIn({ box, canvas, zoom: 2, maxZoom: 2 })).toBe(true);
	});
});

describe("closesOnZoomOut", () => {
	test("closes well below the zoom that fits the nodes", () => {
		const content = { width: 600, height: 200 };
		// A fit shows these nodes at 1 (the cap).
		expect(closesOnZoomOut({ content, canvas, zoom: 0.9, minZoom: 0.2 })).toBe(
			false,
		);
		expect(closesOnZoomOut({ content, canvas, zoom: 0.55, minZoom: 0.2 })).toBe(
			false,
		);
		expect(closesOnZoomOut({ content, canvas, zoom: 0.35, minZoom: 0.2 })).toBe(
			true,
		);
	});
	test("closes at the least zoom", () => {
		const content = { width: 6000, height: 4000 };
		expect(closesOnZoomOut({ content, canvas, zoom: 0.2, minZoom: 0.2 })).toBe(
			true,
		);
	});
});

describe("zoomAfterClose", () => {
	test("shows the box at about half the canvas, too small to open again", () => {
		const box = { width: 256, height: 160 };
		const zoom = zoomAfterClose({ box, canvas, minZoom: 0.2, maxZoom: 4 });
		expect(zoom).toBeCloseTo((1200 * 0.55) / 256);
		expect(opensOnZoomIn({ box, canvas, zoom, maxZoom: 4 })).toBe(false);
		// Never at the zoom where every box opens.
		const capped = zoomAfterClose({ box, canvas, minZoom: 0.2, maxZoom: 2 });
		expect(capped).toBeCloseTo(1.6);
		expect(opensOnZoomIn({ box, canvas, zoom: capped, maxZoom: 2 })).toBe(
			false,
		);
		const big = { width: 1800, height: 900 };
		expect(
			zoomAfterClose({ box: big, canvas, minZoom: 0.2, maxZoom: 2 }),
		).toBeCloseTo((1200 * 0.55) / 1800);
	});
});

describe("handOver", () => {
	test("shows the new rect where the old one shows, as big as fits, centred", () => {
		const now = { x: 100, y: 50, zoom: 2 };
		const box = { x: 0, y: 0, width: 200, height: 100 };
		const nodes = { x: 0, y: 0, width: 800, height: 200 };
		const view = handOver(box, nodes, now);
		// The box shows 400 x 200 at 100, 50: the nodes fill its width.
		expect(view.zoom).toBe(0.5);
		const left = nodes.x * view.zoom + view.x;
		const top = nodes.y * view.zoom + view.y;
		expect(left).toBe(100);
		expect(top).toBe(100);
		expect(nodes.width * view.zoom).toBe(400);
		// And back: the box where the nodes are.
		const back = handOver(nodes, box, view);
		expect(back.zoom).toBe(1);
		expect(box.x * back.zoom + back.x).toBe(100 + 100);
	});
});
