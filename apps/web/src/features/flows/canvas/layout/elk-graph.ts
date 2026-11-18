import type {
	ElkExtendedEdge,
	ElkNode,
	LayoutOptions,
} from "elkjs/lib/elk-api.js";
import type { LayoutEdge, LayoutGraph, LayoutNode, Size } from "./layout-graph";
import { sectionNodeId } from "./layout-graph";

/** Lays out an ELK graph: elkjs in a Web Worker in the app, in the same
 *  thread in tests. */
export type ElkLayout = (graph: ElkNode) => Promise<ElkNode>;

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

export type Direction = "right" | "down" | "wrapped";

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

export function candidateOptions(
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
export function splitEdges(graph: LayoutGraph) {
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
