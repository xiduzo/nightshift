// Arrange a flow and route its edges, the way you would draw it by hand.
//
// ELK Layered, because a flow is a layered graph with crossings to keep
// down, ports in a fixed order, labels that need room and loops to route
// around the nodes. That is not a few lines of our own code.
//
// Three steps, each its own function:
//
// 1. `flowGraph` turns the flow into a `LayoutGraph`: nodes with their
//    handles as ports, one edge per node pair, the model order that tells
//    ELK which edges loop back, and the flow's Sections as groups. A folded
//    Section is one node: its members go, and their edges end on its box.
// 2. `elkGraph` turns a `LayoutGraph` into ELK's JSON for one candidate
//    (left to right, top to bottom, or wrapped into rows), and `readLayout`
//    reads ELK's answer back into boxes and routes.
// 3. `layoutBest` lays out every candidate and keeps the one whose nodes
//    show biggest when fitted to the viewport.
//
// An open Section is a compound node with `hierarchyHandling:
// SEPARATE_CHILDREN`: ELK lays out its members first, always left to right,
// then the top level in the candidate's direction. In that mode an edge
// that crosses a frame gets no route, so `splitEdges` cuts it in up to
// three pieces: node to a port on the frame (inside), port to port (top
// level), port to node (inside the other Section). `readLayout` joins the
// pieces back into one route under the edge's own id. Loops keep their
// `back` hint on the top-level piece, or ELK may put a later Section first
// (research §5.1).

import {
	type Flow,
	type FlowSection,
	moveNode,
	nodeOutcomes,
	sectionBoundary,
} from "@nightshift/flows";
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
export type Box = Size & Point;

/** Lays out an ELK graph: elkjs in a Web Worker in the app, in the same
 *  thread in tests. */
export type ElkLayout = (graph: ElkNode) => Promise<ElkNode>;

/** Where a node's handles sit, from its top-left corner. */
export type NodeHandles = {
	input?: Point;
	outcomes: Record<string, Point>;
};

/** A node React Flow has not measured yet: `w-56` and three outcomes. Only
 *  affects spacing, never correctness. */
const FALLBACK_WIDTH = 224;
const FALLBACK_HEIGHT = 120;
/** Where `flow-node.tsx` draws the input handle, from the top. */
const INPUT_Y = 26;
/** An outcome row, and the padding under the last one. */
const ROW_HEIGHT = 20;
const ROWS_BOTTOM = 5;

/**
 * The room inside an open Section's frame, around its members. The top
 * holds the frame's label. The frame node on the canvas uses the same
 * numbers, so a frame drawn around its members matches the layout.
 */
export const SECTION_PADDING = {
	top: 48,
	right: 24,
	bottom: 24,
	left: 24,
} as const;

/** A folded Section React Flow has not measured yet: a label above one row
 *  per exit. */
const FOLDED_WIDTH = 256;
const FOLDED_HEADER = 64;

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
	/** Nodes laid out together inside a frame, left to right. A node is in
	 *  at most one group. */
	groups?: LayoutGroup[];
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

/** An open Section: its frame is a box of its own, keyed `sectionNodeId(id)`. */
export type LayoutGroup = {
	id: string;
	/** Node ids, in model order. */
	nodes: string[];
};

export type Laid = {
	/** By node id, and by `sectionNodeId` for frames and folded Sections. */
	boxes: Map<string, Box>;
	/** By edge id. */
	routes: Map<string, EdgeRoute>;
};

export type Direction = "right" | "down" | "wrapped";

/** The id of a Section's frame or folded box in a `LayoutGraph`. Node ids
 *  have no colon, so it never meets one. */
export const sectionNodeId = (id: string) => `section:${id}`;

/** What the candidates share, and what every open Section uses inside. */
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

/** An open Section: its own layout run, left to right whatever the top
 *  level does, with ports on its frame for the edges that cross it. */
const GROUP_OPTIONS: LayoutOptions = {
	...BASE_OPTIONS,
	"elk.direction": "RIGHT",
	"elk.hierarchyHandling": "SEPARATE_CHILDREN",
	// Edges come in on the left and leave on the right. ELK picks the
	// spot on that side.
	"elk.portConstraints": "FIXED_SIDE",
	"elk.padding": `[top=${SECTION_PADDING.top},left=${SECTION_PADDING.left},bottom=${SECTION_PADDING.bottom},right=${SECTION_PADDING.right}]`,
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

/**
 * The Sections the layout keeps together: those with nodes, all of them
 * known, and none in a Section before it. The file's checks report the
 * others. Their nodes are laid out as if they had no Section.
 */
export function layoutSections(flow: Flow): FlowSection[] {
	const known = new Set(flow.nodes.map((node) => node.id));
	const taken = new Set<string>();
	return (flow.sections ?? []).filter((section) => {
		const ids = [...new Set(section.nodes)];
		if (ids.length === 0) return false;
		if (ids.some((id) => !known.has(id) || taken.has(id))) return false;
		for (const id of ids) taken.add(id);
		return true;
	});
}

const inputPort = (node: string) => `${node}\u0000in`;
const outcomePort = (node: string, outcome: string) =>
	`${node}\u0000out\u0000${outcome}`;

/** Ports in rows like `flow-node.tsx` draws them: the input near the top
 *  on the left, one row per outcome at the bottom on the right. */
function rowPorts(
	node: string,
	size: Size,
	input: Point | undefined,
	outcomes: { id: string; at?: Point }[],
): LayoutPort[] {
	return [
		{ id: inputPort(node), side: "WEST", ...(input ?? { x: 0, y: INPUT_Y }) },
		...outcomes.map(
			({ id, at }, index): LayoutPort => ({
				id,
				side: "EAST",
				...(at ?? {
					x: size.width,
					y:
						size.height -
						ROWS_BOTTOM -
						(outcomes.length - index) * ROW_HEIGHT +
						ROW_HEIGHT / 2,
				}),
			}),
		),
	];
}

export type FlowGraphOptions = {
	/** Measured node sizes, by node id. */
	sizes?: Record<string, Size>;
	handles?: Record<string, NodeHandles>;
	/** The ids of the Sections that show as one box. */
	folded?: ReadonlySet<string>;
	/** Measured folded boxes, by Section id. */
	sectionSizes?: Record<string, Size>;
	/** Where a folded box has its handles, by Section id. Its exits are
	 *  keyed by `SectionExit.label` ("verdict · pass"). */
	sectionHandles?: Record<string, NodeHandles>;
};

/**
 * The flow as a graph to lay out: one edge per node pair, under the pair's
 * key, from the port of its first outcome. Edges to nodes that are gone are
 * left out. Each open Section is a group. Each folded Section is one node,
 * keyed `sectionNodeId`, with one input and one port per exit: the edges of
 * its members end there, and the edges between its members go.
 */
export function flowGraph(
	flow: Flow,
	{
		sizes = {},
		handles = {},
		folded = new Set(),
		sectionSizes = {},
		sectionHandles = {},
	}: FlowGraphOptions = {},
): LayoutGraph {
	const byId = new Map(flow.nodes.map((node) => [node.id, node]));
	const sections = layoutSections(flow);
	const foldedOf = new Map<string, FlowSection>();
	for (const section of sections) {
		if (!folded.has(section.id)) continue;
		for (const id of section.nodes) foldedOf.set(id, section);
	}

	const ports = new Set<string>();
	const exitPort = new Map<string, string>();
	const { order, back } = walk(flow);
	const nodes: LayoutNode[] = [];
	for (const id of order) {
		const section = foldedOf.get(id);
		if (section) {
			// The box takes the place of its first member in model order.
			const box = sectionNodeId(section.id);
			if (ports.has(inputPort(box))) continue;
			const measured = sectionHandles[section.id];
			const exits = sectionBoundary(flow, section.nodes).outgoing;
			const size = sectionSizes[section.id] ?? {
				width: FOLDED_WIDTH,
				height: FOLDED_HEADER + exits.length * ROW_HEIGHT + ROWS_BOTTOM,
			};
			const boxPorts = rowPorts(
				box,
				size,
				measured?.input,
				exits.map((exit) => {
					const port = outcomePort(box, exit.label);
					exitPort.set(outcomePort(exit.from, exit.outcome), port);
					return { id: port, at: measured?.outcomes[exit.label] };
				}),
			);
			for (const port of boxPorts) ports.add(port.id);
			nodes.push({ id: box, ...size, ports: boxPorts });
			continue;
		}
		const node = byId.get(id) as Flow["nodes"][number];
		const size = {
			width: sizes[id]?.width ?? FALLBACK_WIDTH,
			height: sizes[id]?.height ?? FALLBACK_HEIGHT,
		};
		const measured = handles[id];
		const nodePorts = rowPorts(
			id,
			size,
			measured?.input,
			[...new Set(nodeOutcomes(node))].map((outcome) => ({
				id: outcomePort(id, outcome),
				at: measured?.outcomes[outcome],
			})),
		);
		for (const port of nodePorts) ports.add(port.id);
		nodes.push({ id, ...size, ports: nodePorts });
	}

	const edges = groupEdges(flow).flatMap((group): LayoutEdge[] => {
		const from = foldedOf.get(group.from);
		const to = foldedOf.get(group.to);
		// Inside a folded Section: nothing to draw.
		if (from && from === to) return [];
		const segments = groupSegments(flow, group);
		const text = labelText(segments);
		const port = outcomePort(group.from, group.edges[0]?.outcome ?? "");
		const sourcePort = from ? exitPort.get(port) : port;
		return [
			{
				id: group.key,
				source: from ? sectionNodeId(from.id) : group.from,
				sourcePort:
					sourcePort && ports.has(sourcePort) ? sourcePort : undefined,
				target: to ? sectionNodeId(to.id) : group.to,
				targetPort: inputPort(to ? sectionNodeId(to.id) : group.to),
				back: group.edges.some((edge) => back.has(edge.id)),
				label: labelAtRest(segments)
					? {
							text,
							width: Math.ceil(text.length * LABEL_CHAR + LABEL_PADDING),
							height: LABEL_HEIGHT,
						}
					: undefined,
			},
		];
	});

	const groups = sections
		.filter((section) => !folded.has(section.id))
		.map((section): LayoutGroup => {
			const members = new Set(section.nodes);
			return { id: section.id, nodes: order.filter((id) => members.has(id)) };
		});
	return groups.length > 0 ? { nodes, edges, groups } : { nodes, edges };
}

/** One edge ELK lays out: a whole edge, or the part of one inside or
 *  between frames. */
type Piece = {
	id: string;
	/** The group that holds it; the top level when absent. */
	group?: string;
	source: string;
	target: string;
	back?: boolean;
	label?: LayoutEdge["label"];
};

/**
 * The edges as ELK lays them out, and which pieces make each edge. An edge
 * that crosses a frame leaves its Section by a port on the frame's right
 * side and enters by one on the left. Edges that leave by the same handle,
 * or enter at the same handle, share their piece inside the frame.
 */
function splitEdges(graph: LayoutGraph) {
	const groupOf = new Map<string, string>();
	for (const group of graph.groups ?? []) {
		for (const id of group.nodes) groupOf.set(id, group.id);
	}
	const pieces = new Map<string, Piece>();
	const framePorts = new Map<string, { id: string; side: "WEST" | "EAST" }[]>();
	const joins = new Map<string, string[]>();
	// The frame port, and the piece inside, for one handle inside a frame.
	const through = (
		group: string,
		handle: string,
		side: "WEST" | "EAST",
	): { port: string; piece: string } => {
		const port = `${sectionNodeId(group)}\u0000${side === "WEST" ? "in" : "out"}\u0000${handle}`;
		const piece = `${port}\u0000piece`;
		if (!pieces.has(piece)) {
			const list = framePorts.get(group) ?? [];
			list.push({ id: port, side });
			framePorts.set(group, list);
			pieces.set(
				piece,
				side === "EAST"
					? { id: piece, group, source: handle, target: port }
					: { id: piece, group, source: port, target: handle },
			);
		}
		return { port, piece };
	};

	for (const edge of graph.edges) {
		const source = edge.sourcePort ?? edge.source;
		const target = edge.targetPort ?? edge.target;
		const from = groupOf.get(edge.source);
		const to = groupOf.get(edge.target);
		const whole = { back: edge.back, label: edge.label };
		if (from === to) {
			pieces.set(edge.id, {
				id: edge.id,
				group: from,
				source,
				target,
				...whole,
			});
			joins.set(edge.id, [edge.id]);
			continue;
		}
		const out = from ? through(from, source, "EAST") : undefined;
		const into = to ? through(to, target, "WEST") : undefined;
		pieces.set(edge.id, {
			id: edge.id,
			source: out?.port ?? source,
			target: into?.port ?? target,
			...whole,
		});
		joins.set(
			edge.id,
			[out?.piece, edge.id, into?.piece].filter(
				(id): id is string => id !== undefined,
			),
		);
	}
	return { pieces: [...pieces.values()], framePorts, joins };
}

function elkEdge(piece: Piece): ElkExtendedEdge {
	return {
		id: piece.id,
		// A loop goes in reversed, so the graph ELK sees has no cycle and
		// ranks the loop's target first. ELK's own cycle breaking drops
		// some loops when it wraps a flow into rows.
		sources: [piece.back ? piece.target : piece.source],
		targets: [piece.back ? piece.source : piece.target],
		labels: piece.label
			? [
					{
						text: piece.label.text,
						width: piece.label.width,
						height: piece.label.height,
					},
				]
			: undefined,
	};
}

function elkNode(node: LayoutNode): ElkNode {
	return {
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
	};
}

/** The graph in ELK's JSON, with one candidate's options for the top
 *  level. Open Sections lay out left to right inside. */
export function elkGraph(
	graph: LayoutGraph,
	options: LayoutOptions = {},
): ElkNode {
	const { pieces, framePorts } = splitEdges(graph);
	const groupOf = new Map<string, string>();
	const frames = new Map<string, ElkNode>();
	for (const group of graph.groups ?? []) {
		for (const id of group.nodes) groupOf.set(id, group.id);
		frames.set(group.id, {
			id: sectionNodeId(group.id),
			layoutOptions: GROUP_OPTIONS,
			ports: (framePorts.get(group.id) ?? []).map((port) => ({
				id: port.id,
				width: 0,
				height: 0,
				layoutOptions: { "elk.port.side": port.side },
			})),
			children: [],
			edges: [],
		});
	}
	// Model order: a frame takes the place of its first member.
	const children: ElkNode[] = [];
	for (const node of graph.nodes) {
		const group = groupOf.get(node.id);
		const frame = group ? frames.get(group) : undefined;
		if (!frame) {
			children.push(elkNode(node));
			continue;
		}
		if (frame.children?.length === 0) children.push(frame);
		frame.children?.push(elkNode(node));
	}
	const edges: ElkExtendedEdge[] = [];
	for (const piece of pieces) {
		const frame = piece.group ? frames.get(piece.group) : undefined;
		(frame ? (frame.edges ?? []) : edges).push(elkEdge(piece));
	}
	return {
		id: "root",
		layoutOptions: { ...BASE_OPTIONS, ...options },
		children,
		edges,
	};
}

/** The points without repeats, and without the middle of three in line. */
function tidy(points: Point[]): Point[] {
	const out: Point[] = [];
	for (const point of points) {
		const last = out[out.length - 1];
		if (last && last.x === point.x && last.y === point.y) continue;
		const before = out[out.length - 2];
		if (
			before &&
			last &&
			((before.x === last.x && last.x === point.x) ||
				(before.y === last.y && last.y === point.y))
		) {
			out[out.length - 1] = point;
			continue;
		}
		out.push(point);
	}
	return out;
}

/**
 * ELK's answer as boxes and routes, moved so the top-left box is at 0, 0.
 * Loops come back the right way round, and the pieces of an edge that
 * crosses a frame join into one route. An edge whose route misses its
 * handles gets none.
 */
export function readLayout(result: ElkNode, graph: LayoutGraph): Laid {
	const { pieces, joins } = splitEdges(graph);
	const back = new Set(
		pieces.filter((piece) => piece.back).map((piece) => piece.id),
	);
	const boxes = new Map<string, Box>();
	const elkEdges: ElkExtendedEdge[] = [];
	const collect = (node: ElkNode) => {
		elkEdges.push(...((node.edges ?? []) as ElkExtendedEdge[]));
		for (const child of node.children ?? []) {
			boxes.set(child.id, {
				x: child.x ?? 0,
				y: child.y ?? 0,
				width: child.width ?? 0,
				height: child.height ?? 0,
			});
			collect(child);
		}
	};
	collect(result);
	const all = [...boxes.values()];
	const left = Math.min(...all.map((box) => box.x));
	const top = Math.min(...all.map((box) => box.y));
	const shift = (point: Point) => ({ x: point.x - left, y: point.y - top });
	for (const box of all) Object.assign(box, shift(box));

	const parts = new Map<string, EdgeRoute>();
	for (const edge of elkEdges) {
		const section = edge.sections?.[0];
		if (!section) continue;
		const label = edge.labels?.[0];
		const points = [
			section.startPoint,
			...(section.bendPoints ?? []),
			section.endPoint,
		].map(shift);
		if (back.has(edge.id)) points.reverse();
		parts.set(edge.id, {
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

	// Where each handle landed, to check the routes against.
	const handleAt = new Map<string, Point>();
	for (const node of graph.nodes) {
		const box = boxes.get(node.id);
		if (!box) continue;
		for (const port of node.ports) {
			handleAt.set(port.id, { x: box.x + port.x, y: box.y + port.y });
		}
	}
	const meets = (point: Point | undefined, handle: Point | undefined) =>
		!point ||
		!handle ||
		(Math.abs(point.x - handle.x) <= 1 && Math.abs(point.y - handle.y) <= 1);
	const handle = (port: string | undefined) =>
		port === undefined ? undefined : handleAt.get(port);

	const routes = new Map<string, EdgeRoute>();
	for (const edge of graph.edges) {
		const found = (joins.get(edge.id) ?? []).map((part) => parts.get(part));
		if (found.length === 0 || found.some((part) => part === undefined)) {
			continue;
		}
		const lines = found.map((part) => part?.points ?? []);
		// ELK's wrapping can leave a loop's route short of its handles. A
		// plain step path draws such an edge better.
		const whole =
			meets(lines[0]?.[0], handle(edge.sourcePort)) &&
			meets(lines.at(-1)?.at(-1), handle(edge.targetPort)) &&
			lines.slice(1).every((line, i) => meets(line[0], lines[i]?.at(-1)));
		if (!whole) continue;
		routes.set(edge.id, {
			points: tidy(lines.flat()),
			label: parts.get(edge.id)?.label,
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
 * viewport, left to right it is. The direction is the top level's: open
 * Sections run left to right inside.
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

/** Where a Section landed: its open frame, or its folded box. */
export type SectionBox = Box & { folded: boolean };

export type LayoutFlowOptions = FlowGraphOptions & {
	layout: ElkLayout;
	viewport?: Size;
};

export type LaidFlow = {
	flow: Flow;
	/** By pair key. An edge between two nodes of one folded Section has none. */
	routes: Map<string, EdgeRoute>;
	direction?: Direction;
	/** By Section id, on the canvas grid. Sections the layout left out (see
	 *  `layoutSections`) have none. */
	sections: Map<string, SectionBox>;
};

const snap = (value: number) => Math.round(value / GRID) * GRID;
const floorGrid = (value: number) => Math.floor(value / GRID) * GRID;
const ceilGrid = (value: number) => Math.ceil(value / GRID) * GRID;

/**
 * Lay out the flow and route its edges. Returns the flow with new
 * positions, on the canvas grid, a route per node pair, by pair key, and
 * a box per Section. The members of a folded Section move together, so
 * that the top-left of their bounds lands where the layout put the box.
 */
export async function layoutFlow(
	flow: Flow,
	{ layout, viewport, ...options }: LayoutFlowOptions,
): Promise<LaidFlow> {
	if (flow.nodes.length === 0) {
		return { flow, routes: new Map(), sections: new Map() };
	}
	const { boxes, routes, direction } = await layoutBest(
		layout,
		flowGraph(flow, options),
		viewport,
	);

	const at = new Map<string, Point>();
	const sections = new Map<string, SectionBox>();
	for (const section of layoutSections(flow)) {
		const box = boxes.get(sectionNodeId(section.id));
		if (!box) continue;
		const folded = options.folded?.has(section.id) ?? false;
		if (folded) {
			const members = flow.nodes.filter((node) =>
				section.nodes.includes(node.id),
			);
			const corner = {
				x: Math.min(...members.map((node) => node.position.x)),
				y: Math.min(...members.map((node) => node.position.y)),
			};
			const shift = { x: snap(box.x) - corner.x, y: snap(box.y) - corner.y };
			for (const node of members) {
				at.set(node.id, {
					x: node.position.x + shift.x,
					y: node.position.y + shift.y,
				});
			}
			sections.set(section.id, {
				x: snap(box.x),
				y: snap(box.y),
				width: box.width,
				height: box.height,
				folded,
			});
			continue;
		}
		// Outward to the grid, so a member snapped by half a step stays inside.
		const x = floorGrid(box.x);
		const y = floorGrid(box.y);
		sections.set(section.id, {
			x,
			y,
			width: ceilGrid(box.x + box.width) - x,
			height: ceilGrid(box.y + box.height) - y,
			folded,
		});
	}
	for (const node of flow.nodes) {
		const box = boxes.get(node.id);
		if (box && !at.has(node.id))
			at.set(node.id, { x: snap(box.x), y: snap(box.y) });
	}

	const laid = flow.nodes.reduce((next, node) => {
		const position = at.get(node.id);
		return position ? moveNode(next, node.id, position) : next;
	}, flow);
	return { flow: laid, routes, direction, sections };
}
