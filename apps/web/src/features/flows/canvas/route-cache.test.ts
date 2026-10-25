import { describe, expect, test } from "bun:test";
import type { EdgeGroup } from "./edge-groups";
import { recordRoutes, routeOf } from "./route-cache";

const group: EdgeGroup = {
	id: "a-pass-b",
	key: "a->b",
	from: "a",
	to: "b",
	edges: [{ id: "a-pass-b", from: "a", outcome: "pass", to: "b" }],
};
const route = {
	points: [
		{ x: 256, y: 20 },
		{ x: 400, y: 20 },
	],
};
const nodes = [
	{ id: "a", position: { x: 0, y: 0 } },
	{ id: "b", position: { x: 400, y: 0 } },
];

describe("routes", () => {
	const book = recordRoutes(nodes, [group], new Map([["a->b", route]]));
	const at = (moved: Record<string, { x: number; y: number }> = {}) =>
		new Map(nodes.map((node) => [node.id, moved[node.id] ?? node.position]));

	test("hold while both nodes stay where the layout put them", () => {
		expect(routeOf(book, group, at())).toEqual(route);
	});

	test("drop when a node moves", () => {
		expect(routeOf(book, group, at({ b: { x: 408, y: 0 } }))).toBeUndefined();
		expect(routeOf(book, group, at({ a: { x: 0, y: 8 } }))).toBeUndefined();
	});

	test("drop when the edges between the nodes change", () => {
		const more: EdgeGroup = {
			...group,
			edges: [
				...group.edges,
				{ id: "a-fail-b", from: "a", outcome: "fail", to: "b" },
			],
		};
		expect(routeOf(book, more, at())).toBeUndefined();
	});

	test("drop when an end folds into a Section box, or unfolds out of one", () => {
		const folded = (id: string) => (id === "b" ? "section:late" : id);
		expect(routeOf(book, group, at(), folded)).toBeUndefined();
		const boxed = recordRoutes(
			nodes,
			[group],
			new Map([["a->b", route]]),
			folded,
		);
		expect(boxed["a->b"]?.ends).toEqual(["a", "section:late"]);
		expect(routeOf(boxed, group, at(), folded)).toEqual(route);
		expect(routeOf(boxed, group, at())).toBeUndefined();
		// Drawn as their nodes: nothing extra in the book.
		expect(book["a->b"]?.ends).toBeUndefined();
		expect(routeOf(book, group, at(), (id) => id)).toEqual(route);
	});
});
