import {
	type Flow,
	type FlowSection,
	nodeOutcomes,
	sectionBoundary,
} from "@nightshift/flows";
import type { Point } from "../edges";
import {
	groupEdges,
	groupSegments,
	labelAtRest,
	labelText,
	segmentIndex,
} from "../edges";

export type Size = { width: number; height: number };
export type Box = Size & Point;

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

/** A folded Section React Flow has not measured yet: a label above one row
 *  per exit. */
const FOLDED_WIDTH = 256;
const FOLDED_HEADER = 64;

/** A label on the canvas: `text-[11px]` monospace in a Badge `h-5 px-2`. */
const LABEL_CHAR = 6.7;
const LABEL_PADDING = 18;
const LABEL_HEIGHT = 20;

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

/** The id of a Section's frame or folded box in a `LayoutGraph`. Node ids
 *  have no colon, so it never meets one. */
export const sectionNodeId = (id: string) => `section:${id}`;

/**
 * A depth-first walk from the start node, each node's edges in the order its
 * handles show. It returns the nodes in reverse postorder: every edge points
 * to a later node, except the edges that really loop back.
 */
export function walk(flow: Flow) {
	const ids = new Set(flow.nodes.map((node) => node.id));
	const byFrom = new Map<string, Flow["edges"]>();
	for (const edge of flow.edges) {
		if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
		const list = byFrom.get(edge.from);
		if (list) list.push(edge);
		else byFrom.set(edge.from, [edge]);
	}
	const outgoing = new Map<string, Flow["edges"]>();
	for (const node of flow.nodes) {
		const rank = nodeOutcomes(node);
		const edges = byFrom.get(node.id);
		outgoing.set(
			node.id,
			edges
				? [...edges].sort(
						(a, b) => rank.indexOf(a.outcome) - rank.indexOf(b.outcome),
					)
				: [],
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

	const indexed = segmentIndex(flow);
	const edges = groupEdges(flow).flatMap((group): LayoutEdge[] => {
		const from = foldedOf.get(group.from);
		const to = foldedOf.get(group.to);
		// Inside a folded Section: nothing to draw.
		if (from && from === to) return [];
		const segments = groupSegments(flow, group, indexed);
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
