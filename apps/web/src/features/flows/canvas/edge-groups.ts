// One drawn edge per node pair. Two outcomes of a node that lead to the same
// node are one line on the canvas, with one label that lists both
// ("pass · changes"). The flow file keeps every edge: the group is only how
// the canvas draws them.

import {
	type Flow,
	type FlowEdge,
	nodeOutcomes,
	type OutcomeColor,
	outcomeColor,
} from "@nightshift/flows";
import { outcomeLabel } from "./outcome-badge";

/** The edges that share a source and a target. */
export type EdgeGroup = {
	/** The first edge's id. The drawn edge has this id. */
	id: string;
	/** Source and target. Stays the same while the group's edges change. */
	key: string;
	from: string;
	to: string;
	/** In the order the source node shows its outcomes. Never empty. */
	edges: FlowEdge[];
};

export function pairKey(from: string, to: string): string {
	return `${from}->${to}`;
}

/**
 * The edges of a flow, one group per source and target. Groups come in the
 * order of their first edge in the file. Edges to a node that is gone get no
 * group: there is nothing to draw them to.
 */
export function groupEdges(flow: Pick<Flow, "nodes" | "edges">): EdgeGroup[] {
	const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
	const groups = new Map<string, FlowEdge[]>();
	for (const edge of flow.edges) {
		if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
		const key = pairKey(edge.from, edge.to);
		const group = groups.get(key);
		if (group) group.push(edge);
		else groups.set(key, [edge]);
	}
	return [...groups.entries()].map(([key, edges]) => {
		const source = nodes.get(edges[0]?.from ?? "");
		const rank = source ? nodeOutcomes(source) : [];
		// Unknown outcomes last; a stable sort keeps the file order otherwise.
		const at = (edge: FlowEdge) => {
			const index = rank.indexOf(edge.outcome);
			return index === -1 ? rank.length : index;
		};
		const sorted = [...edges].sort((a, b) => at(a) - at(b));
		const first = sorted[0] as FlowEdge;
		return { id: first.id, key, from: first.from, to: first.to, edges: sorted };
	});
}

/** What a drawn edge says about one of its edges. */
export type EdgeSegment = {
	/** The edge's id in the flow file. */
	id: string;
	outcome: string;
	/** The colour the source node gives the outcome, if any. */
	color?: OutcomeColor;
	max?: number;
	/** The source node shows this outcome as a row with its own handle. */
	onNode: boolean;
	hasError?: boolean;
	/** Run view only: how often the run took this edge. */
	traversals?: number;
};

/** One segment of a label: the outcome, its max, and how often it was taken. */
export function segmentText(segment: EdgeSegment): string {
	const label = outcomeLabel(segment.outcome);
	const { max, traversals } = segment;
	if (traversals === undefined) return max ? `${label} ×${max}` : label;
	if (traversals > 0)
		return `${label} taken ${traversals}${max ? `/${max}` : ""}`;
	return max ? `${label} max ${max}` : label;
}

/** Between the segments of a label. */
export const SEGMENT_SEPARATOR = " · ";

export function labelText(segments: readonly EdgeSegment[]): string {
	return segments.map(segmentText).join(SEGMENT_SEPARATOR);
}

/**
 * Whether the label shows while the edge is neither hovered nor selected.
 * The node already shows each outcome next to its handle, so a label shows
 * only what the node does not: several outcomes on one line, a max, how
 * often a run took it, an outcome the node does not have, or an error.
 */
export function labelAtRest(segments: readonly EdgeSegment[]): boolean {
	return (
		segments.length > 1 ||
		segments.some(
			(segment) =>
				segment.max !== undefined ||
				!segment.onNode ||
				segment.hasError ||
				(segment.traversals ?? 0) > 0,
		)
	);
}

/** The segments of a group, before the canvas adds errors or run counts. */
export function groupSegments(
	flow: Pick<Flow, "nodes">,
	group: EdgeGroup,
): EdgeSegment[] {
	const source = flow.nodes.find((node) => node.id === group.from);
	const outcomes = source ? nodeOutcomes(source) : [];
	return group.edges.map((edge) => ({
		id: edge.id,
		outcome: edge.outcome,
		color: source ? outcomeColor(source, edge.outcome) : undefined,
		max: edge.max,
		onNode: outcomes.includes(edge.outcome),
	}));
}
