import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowEdge } from "@nightshift/flows";

import { commandNode } from "./flow-draft";
import { layoutFlow } from "./flow-layout";

const origin = { x: 0, y: 0 };

function flowOf(ids: string[], edges: FlowEdge[], start = ids[0] ?? ""): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start,
		nodes: ids.map((id) => commandNode(id, origin)),
		edges,
	};
}

function edge(
	from: string,
	outcome: string,
	to: string,
	max?: number,
): FlowEdge {
	return { id: `${from}-${outcome}-${to}`, from, outcome, to, max };
}

function positions(flow: Flow) {
	return Object.fromEntries(flow.nodes.map((node) => [node.id, node.position]));
}

describe("layoutFlow", () => {
	test("puts a chain in columns, left to right", () => {
		const at = positions(
			layoutFlow(
				flowOf(
					["a", "b", "c"],
					[edge("a", "pass", "b"), edge("b", "pass", "c")],
				),
			),
		);
		expect(at.a.x).toBeLessThan(at.b.x);
		expect(at.b.x).toBeLessThan(at.c.x);
		// A column is a node wide plus the gap between columns.
		expect(at.b.x - at.a.x).toBeGreaterThanOrEqual(256 + 128);
	});

	test("stacks the targets of one node in handle order, apart", () => {
		// The file lists fail first; the handles show pass above fail.
		const at = positions(
			layoutFlow(
				flowOf(
					["a", "onFail", "onPass"],
					[edge("a", "error", "onFail"), edge("a", "success", "onPass")],
				),
			),
		);
		expect(at.onPass.x).toBe(at.onFail.x);
		expect(at.onPass.y).toBeLessThan(at.onFail.y);
		expect(at.onFail.y - at.onPass.y).toBeGreaterThanOrEqual(160);
	});

	test("runs a loop back to the left, from the start node on", () => {
		// The loop's end comes first in the file and the start comes last:
		// insertion order alone would flip the wrong edge.
		const at = positions(
			layoutFlow(
				flowOf(
					["check", "fix", "begin"],
					[
						edge("check", "fail", "fix"),
						edge("fix", "pass", "check", 3),
						edge("begin", "pass", "fix"),
					],
					"begin",
				),
			),
		);
		expect(at.begin.x).toBeLessThan(at.fix.x);
		expect(at.fix.x).toBeLessThan(at.check.x);
	});

	test("keeps nodes apart in a tangled flow", () => {
		// A diamond, two parents that share their targets in opposite handle
		// order, and two loops.
		const flow = layoutFlow(
			flowOf(
				["s", "a", "b", "x", "y", "end"],
				[
					edge("s", "pass", "a"),
					edge("s", "fail", "b"),
					edge("a", "pass", "x"),
					edge("a", "fail", "y"),
					edge("b", "pass", "y"),
					edge("b", "fail", "x"),
					edge("x", "pass", "end"),
					edge("y", "pass", "end"),
					edge("y", "fail", "s", 2),
					edge("end", "fail", "a", 2),
				],
			),
		);
		const boxes = flow.nodes.map(({ position }) => position);
		for (const [i, one] of boxes.entries()) {
			for (const other of boxes.slice(i + 1)) {
				const apart =
					Math.abs(one.x - other.x) >= 256 || Math.abs(one.y - other.y) >= 160;
				expect(apart).toBe(true);
			}
		}
		const at = positions(flow);
		expect(at.s.x).toBeLessThan(at.a.x);
		expect(at.x.x).toBeLessThan(at.end.x);
	});

	test("places nodes without edges, and skips edges to nodes that are gone", () => {
		const flow = layoutFlow(
			flowOf(["a", "b"], [edge("a", "pass", "ghost"), edge("a", "fail", "a")]),
		);
		const at = positions(flow);
		expect(flow.nodes).toHaveLength(2);
		expect(at.a).not.toEqual(at.b);
	});

	test("uses measured sizes and lands on the canvas grid", () => {
		const flow = layoutFlow(flowOf(["a", "b"], [edge("a", "pass", "b")]), {
			sizes: {
				a: { width: 301, height: 97 },
				b: { width: 250, height: 133 },
			},
		});
		for (const { position } of flow.nodes) {
			expect(position.x % 8).toBe(0);
			expect(position.y % 8).toBe(0);
		}
		const at = positions(flow);
		expect(at.b.x - at.a.x).toBeGreaterThanOrEqual(301 + 128 - 8);
	});

	describe("in a viewport", () => {
		const chain = (count: number) => {
			const ids = Array.from({ length: count }, (_, i) => `n${i}`);
			return flowOf(
				ids,
				ids.slice(1).map((id, i) => edge(ids[i] as string, "pass", id)),
			);
		};
		const rows = (flow: Flow) =>
			[...new Set(flow.nodes.map((node) => node.position.y))].length;

		test("wraps a long chain into rows, each left to right", () => {
			const at = positions(
				layoutFlow(chain(12), { viewport: { width: 1000, height: 800 } }),
			);
			expect(
				rows(layoutFlow(chain(12), { viewport: { width: 1000, height: 800 } })),
			).toBeGreaterThan(1);
			// The first row starts at the left and the next one under it.
			expect(at.n0.x).toBe(0);
			const second = Object.values(at).filter((p) => p.y > at.n0.y);
			expect(Math.min(...second.map((p) => p.x))).toBe(0);
			expect(Math.min(...second.map((p) => p.y))).toBeGreaterThanOrEqual(
				at.n0.y + 160 + 128,
			);
			// Reading order is kept: along a row, then down to the next.
			const order = Object.entries(at)
				.sort(([, a], [, b]) => a.y - b.y || a.x - b.x)
				.map(([id]) => id);
			expect(order).toEqual(Array.from({ length: 12 }, (_, i) => `n${i}`));
		});

		test("keeps a short chain in one row", () => {
			expect(
				rows(layoutFlow(chain(3), { viewport: { width: 1000, height: 800 } })),
			).toBe(1);
		});

		test("keeps a flow in one row without a viewport", () => {
			expect(rows(layoutFlow(chain(12)))).toBe(1);
		});

		test("does not cut through a loop", () => {
			// n2 → n5 loops back over three columns: no row may end inside it.
			const flow = chain(12);
			flow.edges.push(edge("n5", "fail", "n2", 3));
			const at = positions(
				layoutFlow(flow, { viewport: { width: 1000, height: 800 } }),
			);
			// A row break sends the next node back to the left.
			for (const [a, b] of [
				["n2", "n3"],
				["n3", "n4"],
				["n4", "n5"],
			] as const) {
				expect(at[b].x).toBeGreaterThan(at[a].x);
			}
		});
	});

	test("changes positions only", () => {
		const flow = flowOf(["a", "b"], [edge("a", "pass", "b")]);
		const laid = layoutFlow(flow);
		expect(laid.edges).toBe(flow.edges);
		expect(laid.nodes.map(({ position: _, ...node }) => node)).toEqual(
			flow.nodes.map(({ position: _, ...node }) => node),
		);
	});

	test("leaves an empty flow alone", () => {
		const flow = flowOf([], []);
		expect(layoutFlow(flow)).toBe(flow);
	});
});
