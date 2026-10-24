import { describe, expect, test } from "bun:test";
import {
	commandNode,
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
} from "@nightshift/flows";
import type { ElkNode } from "elkjs/lib/elk-api.js";

import { groupEdges } from "../../canvas/edge-groups";
import featureFactory from "./fixtures/feature-factory.json";
import { type ElkLayout, flowGraph, layoutFlow, walk } from "./flow-layout";

// elkjs in this thread. Bun defines `self`, so elkjs would look for a Web
// Worker: hide it while elkjs loads.
const layout: ElkLayout = await (async () => {
	const scope = globalThis as { self?: unknown };
	const saved = scope.self;
	delete scope.self;
	try {
		const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
		const elk = new ELK();
		return (graph: ElkNode) => elk.layout(graph);
	} finally {
		scope.self = saved;
	}
})();

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

const laidOut = async (
	flow: Flow,
	options: Omit<Parameters<typeof layoutFlow>[1], "layout"> = {},
) => (await layoutFlow(flow, { layout, ...options })).flow;

function expectApart(flow: Flow, width = 256, height = 160) {
	const boxes = flow.nodes.map(({ position }) => position);
	for (const [i, one] of boxes.entries()) {
		for (const other of boxes.slice(i + 1)) {
			const apart =
				Math.abs(one.x - other.x) >= width ||
				Math.abs(one.y - other.y) >= height;
			expect(apart).toBe(true);
		}
	}
}

describe("walk", () => {
	test("orders nodes so that only loops point back", () => {
		const flow = flowOf(
			["check", "fix", "begin"],
			[
				edge("check", "fail", "fix"),
				edge("fix", "pass", "check", 3),
				edge("begin", "pass", "fix"),
			],
			"begin",
		);
		const { order, back } = walk(flow);
		expect(order).toEqual(["begin", "fix", "check"]);
		expect([...back]).toEqual(["check-fail-fix"]);
	});

	test("does not take a branch that joins again for a loop", () => {
		const flow = flowOf(
			["s", "a", "b", "x"],
			[
				edge("s", "pass", "a"),
				edge("s", "fail", "b"),
				edge("a", "pass", "x"),
				edge("b", "pass", "x"),
			],
		);
		expect(walk(flow).back.size).toBe(0);
	});
});

describe("flowGraph", () => {
	test("makes one edge per node pair, labelled only when the node does not say it", () => {
		const graph = flowGraph(
			flowOf(
				["a", "b", "c"],
				[
					edge("a", "error", "b"),
					edge("a", "success", "b"),
					edge("b", "success", "c"),
					edge("c", "error", "a", 2),
					edge("c", "gone", "b"),
				],
			),
		);
		// Command nodes show success, error and other.
		expect(graph.edges.map((e) => [e.id, e.label?.text])).toEqual([
			["a->b", "success · error"],
			["b->c", undefined],
			["c->a", "error ×2"],
			["c->b", "gone"],
		]);
		expect(graph.edges.map((e) => e.back ?? false)).toEqual([
			false,
			false,
			true,
			true,
		]);
	});

	test("puts each outcome on its own port, in the order the node shows them", () => {
		const graph = flowGraph(flowOf(["a"], []), {
			sizes: { a: { width: 300, height: 120 } },
		});
		const [input, ...outcomes] = graph.nodes[0]?.ports ?? [];
		expect(input).toMatchObject({ side: "WEST", x: 0 });
		expect(outcomes.map((port) => port.side)).toEqual(["EAST", "EAST", "EAST"]);
		expect(outcomes.map((port) => port.x)).toEqual([300, 300, 300]);
		const ys = outcomes.map((port) => port.y);
		expect(ys).toEqual([...ys].sort((a, b) => a - b));
		expect(ys[2]).toBeLessThan(120);
	});
});

describe("layoutFlow", () => {
	test("puts a chain in columns, left to right", async () => {
		const at = positions(
			await laidOut(
				flowOf(
					["a", "b", "c"],
					[edge("a", "pass", "b"), edge("b", "pass", "c")],
				),
			),
		);
		expect(at.a.x).toBeLessThan(at.b.x);
		expect(at.b.x).toBeLessThan(at.c.x);
		// A column is a node wide plus the gap between columns.
		expect(at.b.x - at.a.x).toBeGreaterThanOrEqual(256 + 64);
	});

	test("stacks the targets of one node in handle order, apart", async () => {
		// The file lists fail first; the handles show pass above fail.
		const at = positions(
			await laidOut(
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

	test("runs a loop back to the left, from the start node on", async () => {
		// The loop's end comes first in the file and the start comes last:
		// insertion order alone would flip the wrong edge.
		const { flow, routes } = await layoutFlow(
			flowOf(
				["check", "fix", "begin"],
				[
					edge("check", "error", "fix"),
					edge("fix", "success", "check", 3),
					edge("begin", "success", "fix"),
				],
				"begin",
			),
			{ layout },
		);
		const at = positions(flow);
		expect(at.begin.x).toBeLessThan(at.fix.x);
		expect(at.fix.x).toBeLessThan(at.check.x);
		// The loop's route runs from check's handle to fix's input.
		const loop = routes.get("check->fix")?.points ?? [];
		// Nodes snap to the grid after ELK routes: allow half a grid step.
		expect(loop[0]?.x).toBeGreaterThan(at.check.x + 256 - 4);
		expect(loop[loop.length - 1]?.x).toBeLessThanOrEqual(at.fix.x + 4);
	});

	test("keeps nodes apart in a tangled flow", async () => {
		// A diamond, two parents that share their targets in opposite handle
		// order, and two loops.
		const flow = await laidOut(
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
		expectApart(flow);
		const at = positions(flow);
		expect(at.s.x).toBeLessThan(at.a.x);
		expect(at.x.x).toBeLessThan(at.end.x);
	});

	test("places nodes without edges, and skips edges to nodes that are gone", async () => {
		const flow = await laidOut(
			flowOf(["a", "b"], [edge("a", "pass", "ghost"), edge("a", "fail", "a")]),
		);
		const at = positions(flow);
		expect(flow.nodes).toHaveLength(2);
		expect(at.a).not.toEqual(at.b);
	});

	test("uses measured sizes and lands on the canvas grid", async () => {
		const flow = await laidOut(flowOf(["a", "b"], [edge("a", "pass", "b")]), {
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
		expect(at.b.x - at.a.x).toBeGreaterThanOrEqual(301 + 64 - 8);
	});

	describe("in a viewport", () => {
		const chain = (count: number) => {
			const ids = Array.from({ length: count }, (_, i) => `n${i}`);
			return flowOf(
				ids,
				ids.slice(1).map((id, i) => edge(ids[i] as string, "success", id)),
			);
		};
		// Each node right of the one before it: one row, left to right.
		const leftToRight = (flow: Flow) =>
			flow.nodes.every(
				(node, i) =>
					i === 0 ||
					node.position.x > (flow.nodes[i - 1]?.position.x ?? 0) + 256,
			);
		const viewport = { width: 1000, height: 800 };

		test("turns a long chain so its nodes show bigger", async () => {
			const { flow, direction } = await layoutFlow(chain(12), {
				layout,
				viewport,
			});
			expect(direction).not.toBe("right");
			expect(leftToRight(flow)).toBe(false);
			expectApart(flow);
		});

		test("keeps a short chain in one row", async () => {
			const { flow, direction } = await layoutFlow(chain(3), {
				layout,
				viewport,
			});
			expect(direction).toBe("right");
			expect(leftToRight(flow)).toBe(true);
		});

		test("keeps a flow in one row without a viewport", async () => {
			expect(leftToRight(await laidOut(chain(12)))).toBe(true);
		});
	});

	test("lays out and routes the feature-factory flow", async () => {
		const flow = {
			version: FLOW_VERSION,
			inputs: [],
			outputs: [],
			...featureFactory,
		} as unknown as Flow;
		const started = performance.now();
		const result = await layoutFlow(flow, {
			layout,
			viewport: { width: 1600, height: 900 },
		});
		const took = performance.now() - started;

		expectApart(result.flow);
		const groups = groupEdges(flow);
		expect(flow.edges).toHaveLength(36);
		expect(groups).toHaveLength(28);
		for (const group of groups) {
			const route = result.routes.get(group.key);
			expect(route?.points.length ?? 0).toBeGreaterThanOrEqual(2);
		}
		// Three candidates, the first one with elkjs still warming up.
		expect(took).toBeLessThan(5000);
	});

	test("changes positions only", async () => {
		const flow = flowOf(["a", "b"], [edge("a", "pass", "b")]);
		const laid = await laidOut(flow);
		expect(laid.edges).toBe(flow.edges);
		expect(laid.nodes.map(({ position: _, ...node }) => node)).toEqual(
			flow.nodes.map(({ position: _, ...node }) => node),
		);
	});

	test("leaves an empty flow alone", async () => {
		const flow = flowOf([], []);
		expect(await laidOut(flow)).toBe(flow);
	});
});
