// Arrange a flow and route its edges, the way you would draw it by hand.
//
// ELK Layered, because a flow is a layered graph with crossings to keep
// down, ports in a fixed order, labels that need room and loops to route
// around the nodes. That is not a few lines of our own code.
//
// Three steps, each its own function so that Sections can reuse them:
//
// 1. `flowGraph` turns the flow into a `LayoutGraph`: nodes with their
//    handles as ports, one edge per node pair, and the model order that
//    tells ELK which edges loop back.
// 2. `elkGraph` turns a `LayoutGraph` into ELK's JSON for one candidate
//    (left to right, top to bottom, or wrapped into rows), and `readLayout`
//    reads ELK's answer back into boxes and routes.
// 3. `layoutBest` lays out every candidate and keeps the one whose nodes
//    show biggest when fitted to the viewport.
//
// Extension point for Sections: a `LayoutGraph` will get optional `groups`
// (a Section is a group of node ids). `elkGraph` then makes each group a
// compound node with `elk.hierarchyHandling: SEPARATE_CHILDREN`, so that it
// keeps its own direction, and splits each edge that crosses a group's frame
// into three: node to a port on the frame, port to port at the top level,
// port to node. `readLayout` joins the three routes back into one, under
// the edge's own id. `layoutBest` stays as it is: it scores the top level.

import { type Flow, moveNode, nodeOutcomes } from "@nightshift/flows";
import type {
	ElkExtendedEdge,
	ElkNode,
	LayoutOptions,
} from "elkjs/lib/elk-api.js";
import {
	groupEdges,
	groupSegments,
	labelAtRest,
	labelText,
} from "../../canvas/edge-groups";
import type { EdgeRoute, Point } from "../../canvas/edge-route";

export type Size = { width: number; height: number };
type Box = Size & Point;

/** Lays out an ELK graph: elkjs in a Web Worker in the app, in the same
 *  thread in tests. */
export type ElkLayout = (graph: ElkNode) => Promise<ElkNode>;

/** Where a node's handles sit, from its top-left corner. */
export type NodeHandles = {
	input?: Point;
	outcomes: Record<string, Point>;
};

/** A node React Flow has not measured yet: `w-64` and a typical body. Only
 *  affects spacing, never correctness. */
const FALLBACK_WIDTH = 256;
const FALLBACK_HEIGHT = 160;
/** Where `flow-node.tsx` draws the input handle, from the top. */
const INPUT_Y = 20;
/** An outcome row, and the padding under the last one. */
const ROW_HEIGHT = 20;
const ROWS_BOTTOM = 5;

/** The canvas snaps to this grid, so laid-out nodes land on it too. */
const GRID = 8;

/** A label on the canvas: `text-[11px]` monospace in a Badge `h-5 px-2`. */
const LABEL_CHAR = 6.7;
const LABEL_PADDING = 18;
const LABEL_HEIGHT = 20;

/** Another direction must make the nodes this much bigger on screen to be
 *  worth it. A flow reads best left to right, so a near tie stays there. */
const GAIN = 1.1;

/** A graph to lay out. It knows ports and sizes, nothing of flows. */
export type LayoutGraph = {
	/** In model order: ELK reverses the edges that point to an earlier node. */
	nodes: LayoutNode[];
	edges: LayoutEdge[];
};

export type LayoutNode = Size & {
	id: string;
	/** Inputs on the left side, outcomes on the right. Positions are fixed. */
	ports: LayoutPort[];
};

export type LayoutPort = Point & { id: string; side: "WEST" | "EAST" };

export type LayoutEdge = {
	id: string;
	source: string;
	sourcePort?: string;
	target: string;
	targetPort?: string;
	/** The label the canvas shows on this edge at rest, if any. */
	label?: Size & { text: string };
	/** The edge loops back to a node before its source. */
	back?: boolean;
};

export type Laid = {
	boxes: Map<string, Box>;
	/** By edge id. */
	routes: Map<string, EdgeRoute>;
};

export type Direction = "right" | "down" | "wrapped";

/** What the candidates share. */
const BASE_OPTIONS: LayoutOptions = {
	"elk.algorithm": "layered",
	"elk.edgeRouting": "ORTHOGONAL",
	// Loops come in reversed, so ELK finds no cycle to break. Should one be
	// left, the nodes come in our walk's order: keep it.
	"elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
	// Loops go around the nodes, not through the row.
	"elk.layered.feedbackEdges": "true",
	"elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
	// Roomy on purpose: a label squeezed between two nodes is unreadable.
	"elk.spacing.nodeNode": "64",
	"elk.layered.spacing.nodeNodeBetweenLayers": "96",
	"elk.spacing.edgeNode": "24",
	"elk.layered.spacing.edgeNodeBetweenLayers": "24",
	"elk.spacing.edgeEdge": "16",
	"elk.layered.spacing.edgeEdgeBetweenLayers": "16",
	"elk.spacing.edgeLabel": "4",
	"elk.json.shapeCoords": "ROOT",
	"elk.json.edgeCoords": "ROOT",
};

function candidateOptions(
	direction: Direction,
	viewport: Size | undefined,
): LayoutOptions {
	if (direction === "down") return { "elk.direction": "DOWN" };
	if (direction === "right") return { "elk.direction": "RIGHT" };
	return {
		"elk.direction": "RIGHT",
		// Chunks of the flow, stacked in rows. ELK carries the edges between
		// chunks from the end of one row to the start of the next.
		"elk.layered.wrapping.strategy": "MULTI_EDGE",
		"elk.aspectRatio": String(
			viewport ? viewport.width / viewport.height : 16 / 9,
		),
		"elk.layered.wrapping.additionalEdgeSpacing": "24",
	};
}

/**
 * A depth-first walk from the start node, each node's edges in the order its
 * handles show. It returns the nodes in reverse postorder: every edge points
 * to a later node, except the edges that really loop back.
 */
export function walk(flow: Flow) {
	const ids = new Set(flow.nodes.map((node) => node.id));
	const outgoing = new Map<string, Flow["edges"]>();
	for (const node of flow.nodes) {
		const rank = nodeOutcomes(node);
		outgoing.set(
			node.id,
			flow.edges
				.filter((edge) => edge.from === node.id && ids.has(edge.to))
				.sort((a, b) => rank.indexOf(a.outcome) - rank.indexOf(b.outcome)),
		);
	}

	const seen = new Set<string>();
	const onPath = new Set<string>();
	const finished: string[] = [];
	const back = new Set<string>();
	const visit = (id: string) => {
		seen.add(id);
		onPath.add(id);
		for (const edge of outgoing.get(id) ?? []) {
			if (onPath.has(edge.to)) back.add(edge.id);
			else if (!seen.has(edge.to)) visit(edge.to);
		}
		onPath.delete(id);
		finished.push(id);
	};
	// Start first; then whatever the start cannot reach, in file order.
	if (ids.has(flow.start)) visit(flow.start);
	for (const node of flow.nodes) if (!seen.has(node.id)) visit(node.id);
	return { order: finished.reverse(), back };
}

const inputPort = (node: string) => `${node}\u0000in`;
const outcomePort = (node: string, outcome: string) =>
	`${node}\u0000out\u0000${outcome}`;

/**
 * The flow as a graph to lay out: one edge per node pair, under the pair's
 * key, from the port of its first outcome. Edges to nodes that are gone are
 * left out.
 */
export function flowGraph(
	flow: Flow,
	{
		sizes = {},
		handles = {},
	}: {
		sizes?: Record<string, Size>;
		handles?: Record<string, NodeHandles>;
	} = {},
): LayoutGraph {
	const byId = new Map(flow.nodes.map((node) => [node.id, node]));
	const ports = new Set<string>();
	const { order, back } = walk(flow);
	const nodes = order.map((id): LayoutNode => {
		const node = byId.get(id) as Flow["nodes"][number];
		const width = sizes[id]?.width ?? FALLBACK_WIDTH;
		const height = sizes[id]?.height ?? FALLBACK_HEIGHT;
		const measured = handles[id];
		const outcomes = [...new Set(nodeOutcomes(node))];
		const nodePorts: LayoutPort[] = [
			{
				id: inputPort(id),
				side: "WEST",
				...(measured?.input ?? { x: 0, y: INPUT_Y }),
			},
			...outcomes.map(
				(outcome, index): LayoutPort => ({
					id: outcomePort(id, outcome),
					side: "EAST",
					...(measured?.outcomes[outcome] ?? {
						x: width,
						y:
							height -
							ROWS_BOTTOM -
							(outcomes.length - index) * ROW_HEIGHT +
							ROW_HEIGHT / 2,
					}),
				}),
			),
		];
		for (const port of nodePorts) ports.add(port.id);
		return { id, width, height, ports: nodePorts };
	});

	const edges = groupEdges(flow).map((group): LayoutEdge => {
		const segments = groupSegments(flow, group);
		const text = labelText(segments);
		const port = outcomePort(group.from, group.edges[0]?.outcome ?? "");
		return {
			id: group.key,
			source: group.from,
			sourcePort: ports.has(port) ? port : undefined,
			target: group.to,
			targetPort: inputPort(group.to),
			back: group.edges.some((edge) => back.has(edge.id)),
			label: labelAtRest(segments)
				? {
						text,
						width: Math.ceil(text.length * LABEL_CHAR + LABEL_PADDING),
						height: LABEL_HEIGHT,
					}
				: undefined,
		};
	});
	return { nodes, edges };
}

/** The graph in ELK's JSON, with one candidate's options. */
export function elkGraph(
	graph: LayoutGraph,
	options: LayoutOptions = {},
): ElkNode {
	return {
		id: "root",
		layoutOptions: { ...BASE_OPTIONS, ...options },
		children: graph.nodes.map((node) => ({
			id: node.id,
			width: node.width,
			height: node.height,
			layoutOptions: { "elk.portConstraints": "FIXED_POS" },
			ports: node.ports.map((port) => ({
				id: port.id,
				x: port.x,
				y: port.y,
				width: 0,
				height: 0,
				layoutOptions: { "elk.port.side": port.side },
			})),
		})),
		edges: graph.edges.map((edge): ElkExtendedEdge => {
			const source = edge.sourcePort ?? edge.source;
			const target = edge.targetPort ?? edge.target;
			return {
				id: edge.id,
				// A loop goes in reversed, so the graph ELK sees has no cycle and
				// ranks the loop's target first. ELK's own cycle breaking drops
				// some loops when it wraps a flow into rows.
				sources: [edge.back ? target : source],
				targets: [edge.back ? source : target],
				labels: edge.label
					? [
							{
								text: edge.label.text,
								width: edge.label.width,
								height: edge.label.height,
							},
						]
					: undefined,
			};
		}),
	};
}

/**
 * ELK's answer as boxes and routes, moved so the top-left node is at 0, 0.
 * Loops come back the right way round.
 */
export function readLayout(result: ElkNode, graph: LayoutGraph): Laid {
	const back = new Set(
		graph.edges.filter((edge) => edge.back).map((edge) => edge.id),
	);
	const boxes = new Map<string, Box>();
	for (const child of result.children ?? []) {
		boxes.set(child.id, {
			x: child.x ?? 0,
			y: child.y ?? 0,
			width: child.width ?? 0,
			height: child.height ?? 0,
		});
	}
	const all = [...boxes.values()];
	const left = Math.min(...all.map((box) => box.x));
	const top = Math.min(...all.map((box) => box.y));
	const shift = (point: Point) => ({ x: point.x - left, y: point.y - top });
	for (const box of all) Object.assign(box, shift(box));

	const routes = new Map<string, EdgeRoute>();
	for (const edge of result.edges ?? []) {
		const section = (edge as ElkExtendedEdge).sections?.[0];
		if (!section) continue;
		const label = edge.labels?.[0];
		const points = [
			section.startPoint,
			...(section.bendPoints ?? []),
			section.endPoint,
		].map(shift);
		if (back.has(edge.id)) points.reverse();
		routes.set(edge.id, {
			points,
			label:
				label?.x !== undefined && label.y !== undefined
					? shift({
							x: label.x + (label.width ?? 0) / 2,
							y: label.y + (label.height ?? 0) / 2,
						})
					: undefined,
		});
	}
	return { boxes, routes };
}

/** The zoom a fit would land on, capped where the canvas stops zooming in. */
export function fitZoom(boxes: Map<string, Box>, viewport: Size): number {
	const all = [...boxes.values()];
	const width =
		Math.max(...all.map((box) => box.x + box.width)) -
		Math.min(...all.map((box) => box.x));
	const height =
		Math.max(...all.map((box) => box.y + box.height)) -
		Math.min(...all.map((box) => box.y));
	return Math.min(1, viewport.width / width, viewport.height / height);
}

/**
 * Lay out the graph in each direction and keep the one whose nodes show
 * biggest in the viewport. Left to right wins a near tie. Without a
 * viewport, left to right it is.
 */
export async function layoutBest(
	layout: ElkLayout,
	graph: LayoutGraph,
	viewport?: Size,
): Promise<Laid & { direction: Direction }> {
	const directions: Direction[] = viewport
		? ["right", "wrapped", "down"]
		: ["right"];
	let best: (Laid & { direction: Direction; zoom: number }) | undefined;
	for (const direction of directions) {
		const laid = readLayout(
			await layout(elkGraph(graph, candidateOptions(direction, viewport))),
			graph,
		);
		const zoom = viewport ? fitZoom(laid.boxes, viewport) : 1;
		if (!best || zoom > best.zoom * GAIN) best = { ...laid, direction, zoom };
	}
	const { zoom: _, ...laid } = best as NonNullable<typeof best>;
	return laid;
}

/**
 * Lay out the flow and route its edges. Returns the flow with new
 * positions, on the canvas grid, and a route per node pair, by pair key.
 */
export async function layoutFlow(
	flow: Flow,
	{
		layout,
		sizes,
		handles,
		viewport,
	}: {
		layout: ElkLayout;
		sizes?: Record<string, Size>;
		handles?: Record<string, NodeHandles>;
		viewport?: Size;
	},
): Promise<{
	flow: Flow;
	routes: Map<string, EdgeRoute>;
	direction?: Direction;
}> {
	if (flow.nodes.length === 0) return { flow, routes: new Map() };
	const { boxes, routes, direction } = await layoutBest(
		layout,
		flowGraph(flow, { sizes, handles }),
		viewport,
	);
	const snap = (value: number) => Math.round(value / GRID) * GRID;
	const laid = flow.nodes.reduce((next, node) => {
		const box = boxes.get(node.id);
		return box
			? moveNode(next, node.id, { x: snap(box.x), y: snap(box.y) })
			: next;
	}, flow);
	return { flow: laid, routes, direction };
}
