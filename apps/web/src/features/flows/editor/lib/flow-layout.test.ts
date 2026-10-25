import { describe, expect, test } from "bun:test";
import {
	commandNode,
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	nodeOutcomes,
} from "@nightshift/flows";
import type { ElkNode } from "elkjs/lib/elk-api.js";

import { groupEdges } from "../../canvas/edge-groups";
import featureFactory from "./fixtures/feature-factory.json";
import {
	type Box,
	type ElkLayout,
	elkGraph,
	flowGraph,
	type LaidFlow,
	layoutFlow,
	readLayout,
	SECTION_PADDING,
	sectionNodeId,
	walk,
} from "./flow-layout";

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
			// ELK's wrapping leaves some loops without a usable route: those
			// get none, and the canvas draws a plain step path.
			if (!route && result.direction === "wrapped") continue;
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

	test("gives no route to an edge whose route misses its handles", async () => {
		const graph = flowGraph(flowOf(["a", "b"], [edge("a", "success", "b")]));
		const result = await layout(elkGraph(graph));
		expect(readLayout(result, graph).routes.has("a->b")).toBe(true);
		const [line] = result.edges ?? [];
		const section = line?.sections?.[0];
		if (section) section.endPoint = { x: section.endPoint.x, y: -400 };
		expect(readLayout(result, graph).routes.has("a->b")).toBe(false);
	});

	test("leaves an empty flow alone", async () => {
		const flow = flowOf([], []);
		expect(await laidOut(flow)).toBe(flow);
	});
});

describe("Sections", () => {
	const sectioned = (
		sections: NonNullable<Flow["sections"]> = [
			{ id: "intake", label: "Intake", nodes: ["branch", "rest", "design"] },
			{ id: "specify", label: "Spec", nodes: ["spec", "clarify", "validate"] },
			{ id: "make", label: "Build", nodes: ["build", "stack", "scope"] },
			{ id: "review", label: "Review", nodes: ["security", "code", "verdict"] },
		],
	) =>
		({
			version: FLOW_VERSION,
			inputs: [],
			outputs: [],
			...featureFactory,
			sections,
		}) as unknown as Flow;
	const flow = sectioned();
	const W = 256;
	const H = 160;
	const order = ["intake", "specify", "make", "review"];

	const overlap = (a: Box, b: Box) =>
		a.x < b.x + b.width &&
		b.x < a.x + a.width &&
		a.y < b.y + b.height &&
		b.y < a.y + a.height;
	const nodeBox = (laid: Flow, id: string): Box => {
		const node = laid.nodes.find((candidate) => candidate.id === id);
		return { ...(node?.position ?? origin), width: W, height: H };
	};

	/** Every visible thing apart; members inside their frame, under its label. */
	function expectTidy({
		flow: laid,
		sections,
	}: Pick<LaidFlow, "flow" | "sections">) {
		const owner = new Map<string, string>();
		for (const id of sections.keys()) {
			const section = laid.sections?.find((candidate) => candidate.id === id);
			for (const node of section?.nodes ?? []) owner.set(node, id);
		}
		const visible: [string, Box][] = [];
		for (const [id, box] of sections) visible.push([`section ${id}`, box]);
		for (const node of laid.nodes) {
			const section = owner.get(node.id);
			const frame = section ? sections.get(section) : undefined;
			if (!frame) {
				visible.push([node.id, nodeBox(laid, node.id)]);
				continue;
			}
			if (frame.folded) continue;
			const box = nodeBox(laid, node.id);
			expect(box.x).toBeGreaterThanOrEqual(frame.x + SECTION_PADDING.left - 8);
			expect(box.y).toBeGreaterThanOrEqual(frame.y + SECTION_PADDING.top - 8);
			expect(box.x + W).toBeLessThanOrEqual(frame.x + frame.width);
			expect(box.y + H).toBeLessThanOrEqual(frame.y + frame.height);
			// Other members only.
			for (const other of laid.nodes) {
				if (other.id <= node.id || owner.get(other.id) !== section) continue;
				expect(overlap(box, nodeBox(laid, other.id))).toBe(false);
			}
		}
		for (const [i, [id, one]] of visible.entries()) {
			for (const [otherId, other] of visible.slice(i + 1)) {
				if (overlap(one, other)) throw new Error(`${id} overlaps ${otherId}`);
			}
		}
	}

	/** Each route runs in straight lines, without a gap, from handle to handle. */
	function expectRoutes(
		laid: LaidFlow,
		/** A folded Section's box has a handle for every exit. */
		ends: (id: string) => Box & { folded?: boolean } = (id) =>
			nodeBox(laid.flow, id),
	) {
		for (const group of groupEdges(laid.flow)) {
			const route = laid.routes.get(group.key);
			// ELK's wrapping leaves some loops without a usable route.
			if (!route && laid.direction === "wrapped") continue;
			if (!route) throw new Error(`no route for ${group.key}`);
			const { points } = route;
			for (const [i, point] of points.slice(1).entries()) {
				const before = points[i] as { x: number; y: number };
				expect(point.x === before.x || point.y === before.y).toBe(true);
			}
			const first = points[0];
			const last = points[points.length - 1];
			const from = ends(group.from);
			const to = ends(group.to);
			// Nodes snap to the grid after ELK routes: allow half a grid step.
			// An outcome the node does not show has no handle: ELK picks a spot.
			const source = laid.flow.nodes.find((node) => node.id === group.from);
			const shown =
				from.folded ||
				(source &&
					nodeOutcomes(source).includes(group.edges[0]?.outcome ?? ""));
			const off = [
				shown ? Math.abs((first?.x ?? 0) - (from.x + from.width)) : 0,
				Math.abs((last?.x ?? 0) - to.x),
			];
			if (Math.max(...off) > 4) {
				throw new Error(
					`${group.key} is off its handles: ${JSON.stringify({ points, from, to })}`,
				);
			}
		}
	}

	const leftToRightInside = (laid: Flow) => {
		const x = (id: string) => nodeBox(laid, id).x;
		expect(x("branch")).toBeLessThan(x("design"));
		expect(x("spec")).toBeLessThan(x("validate"));
		expect(x("build")).toBeLessThan(x("stack"));
		expect(x("stack")).toBeLessThan(x("scope"));
		expect(x("security")).toBeLessThan(x("code"));
		expect(x("code")).toBeLessThan(x("verdict"));
	};

	test("groups the nodes of each Section, and leaves out Sections it cannot keep", () => {
		const graph = flowGraph(
			sectioned([
				{ id: "intake", label: "Intake", nodes: ["design", "branch", "rest"] },
				{ id: "twice", label: "Twice", nodes: ["rest", "spec"] },
				{ id: "ghost", label: "Ghost", nodes: ["build", "gone"] },
				{ id: "empty", label: "Empty", nodes: [] },
			]),
		);
		// In model order, whatever order the file lists them in.
		expect(graph.groups).toEqual([
			{ id: "intake", nodes: ["branch", "rest", "design"] },
		]);
		expect(flowGraph(sectioned([])).groups).toBeUndefined();
	});

	test("makes a folded Section one box, with an input and a port per exit", () => {
		const graph = flowGraph(flow, {
			folded: new Set(["review"]),
			sectionSizes: { review: { width: 300, height: 140 } },
		});
		const box = graph.nodes.find((node) => node.id === sectionNodeId("review"));
		expect(box).toMatchObject({ width: 300, height: 140 });
		expect(box?.ports.map((port) => port.side)).toEqual([
			"WEST",
			"EAST",
			"EAST",
		]);
		const ids = graph.nodes.map((node) => node.id);
		for (const id of ["security", "code", "verdict"]) {
			expect(ids).not.toContain(id);
		}
		expect(graph.groups?.map((group) => group.id)).toEqual([
			"intake",
			"specify",
			"make",
		]);
		const keys = graph.edges.map((edge) => edge.id);
		expect(keys).not.toContain("security->code");
		expect(keys).not.toContain("code->verdict");
		// verdict.changes leads to build and to publish: one exit, two edges.
		const into = graph.edges.find((edge) => edge.id === "scope->security");
		const back = graph.edges.find((edge) => edge.id === "verdict->build");
		const on = graph.edges.find((edge) => edge.id === "verdict->publish");
		expect(into).toMatchObject({ target: sectionNodeId("review") });
		expect(into?.targetPort).toBe(box?.ports[0]?.id);
		expect(back).toMatchObject({ source: sectionNodeId("review"), back: true });
		expect(back?.sourcePort).toBe(box?.ports[1]?.id);
		expect(on?.sourcePort).toBe(box?.ports[1]?.id);
	});

	test("lays out each direction: members left to right in frames, Sections in order", async () => {
		const graph = flowGraph(flow);
		for (const direction of ["RIGHT", "DOWN"]) {
			const { boxes, routes } = readLayout(
				await layout(elkGraph(graph, { "elk.direction": direction })),
				graph,
			);
			const frames = order.map((id) => boxes.get(sectionNodeId(id)) as Box);
			const along = (box: Box) => (direction === "RIGHT" ? box.x : box.y);
			// Loops between Sections keep their hint: ELK puts no later one first.
			for (const [i, frame] of frames.slice(1).entries()) {
				expect(along(frame)).toBeGreaterThan(along(frames[i] as Box));
			}
			expect(routes.size).toBe(groupEdges(flow).length);
		}
	});

	test("lays out and routes the feature-factory flow with open Sections", async () => {
		const started = performance.now();
		for (const viewport of [
			undefined,
			{ width: 1600, height: 900 },
			{ width: 600, height: 2400 },
		]) {
			const laid = await layoutFlow(flow, { layout, viewport });
			expect([...laid.sections.keys()]).toEqual(order);
			expect([...laid.sections.values()].every((box) => !box.folded)).toBe(
				true,
			);
			expectTidy(laid);
			expectRoutes(laid);
			leftToRightInside(laid.flow);
			for (const box of laid.sections.values()) {
				for (const value of [box.x, box.y, box.width, box.height]) {
					expect(value % 8).toBe(0);
				}
			}
			for (const { position } of laid.flow.nodes) {
				expect(position.x % 8).toBe(0);
				expect(position.y % 8).toBe(0);
			}
		}
		// Nine layouts, the first one with elkjs still warming up.
		expect(performance.now() - started).toBeLessThan(8000);
	});

	test("joins an edge that crosses two frames into one route", async () => {
		const laid = await layoutFlow(flow, { layout });
		const frame = (id: string) => laid.sections.get(id) as Box;
		// scope (Build) to security (Review): out of one frame, into the other.
		const points = laid.routes.get("scope->security")?.points ?? [];
		const xs = points.map((point) => point.x);
		expect(Math.max(...xs)).toBeGreaterThan(frame("review").x);
		expect(Math.min(...xs)).toBeLessThan(frame("make").x + frame("make").width);
		// The loop from verdict back to build runs right to left.
		const loop = laid.routes.get("verdict->build")?.points ?? [];
		expect(loop[0]?.x).toBeGreaterThan(loop[loop.length - 1]?.x ?? 0);
	});

	test("moves the members of a folded Section as one block, onto its box", async () => {
		// Members somewhere, apart: the block keeps their places.
		const spread = {
			...flow,
			nodes: flow.nodes.map((node, i) => ({
				...node,
				position: { x: i * 40, y: 1000 - i * 24 },
			})),
		};
		for (const folded of [
			new Set(["review"]),
			new Set(["intake", "specify", "make", "review"]),
		]) {
			for (const viewport of [undefined, { width: 1600, height: 900 }]) {
				const laid = await layoutFlow(spread, { layout, viewport, folded });
				expectTidy(laid);
				const boxOf = new Map<string, Box & { folded: boolean }>();
				for (const section of spread.sections ?? []) {
					const box = laid.sections.get(section.id) as Box & {
						folded: boolean;
					};
					expect(box.folded).toBe(folded.has(section.id));
					if (!box.folded) continue;
					const before = spread.nodes.filter((n) =>
						section.nodes.includes(n.id),
					);
					const after = laid.flow.nodes.filter((n) =>
						section.nodes.includes(n.id),
					);
					const dx = (after[0]?.position.x ?? 0) - (before[0]?.position.x ?? 0);
					const dy = (after[0]?.position.y ?? 0) - (before[0]?.position.y ?? 0);
					for (const [i, node] of after.entries()) {
						expect(node.position.x - (before[i]?.position.x ?? 0)).toBe(dx);
						expect(node.position.y - (before[i]?.position.y ?? 0)).toBe(dy);
					}
					expect(Math.min(...after.map((n) => n.position.x))).toBe(box.x);
					expect(Math.min(...after.map((n) => n.position.y))).toBe(box.y);
					for (const id of section.nodes) boxOf.set(id, box);
				}
				// No route inside a folded Section; the others end on its box.
				for (const group of groupEdges(spread)) {
					const from = boxOf.get(group.from);
					if (from && from === boxOf.get(group.to)) {
						expect(laid.routes.has(group.key)).toBe(false);
						continue;
					}
					if (laid.direction !== "wrapped") {
						expect(laid.routes.has(group.key)).toBe(true);
					}
				}
				expectRoutes(
					{
						...laid,
						flow: {
							...laid.flow,
							edges: laid.flow.edges.filter(
								(e) =>
									!boxOf.has(e.from) || boxOf.get(e.from) !== boxOf.get(e.to),
							),
						},
					},
					(id) => boxOf.get(id) ?? nodeBox(laid.flow, id),
				);
			}
		}
	});

	test("lays out the nodes of a Section it cannot keep as loose nodes", async () => {
		const laid = await layoutFlow(
			sectioned([
				{ id: "intake", label: "Intake", nodes: ["branch", "rest", "design"] },
				{ id: "twice", label: "Twice", nodes: ["design", "spec"] },
			]),
			{ layout },
		);
		expect([...laid.sections.keys()]).toEqual(["intake"]);
		expectTidy(laid);
	});
});
