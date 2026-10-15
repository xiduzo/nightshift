import type { NextEdge, NextEdgeInput } from "./types";

/**
 * The edge a run takes after a node ends with an outcome: the first edge (in
 * file order) from that node on that outcome whose `max` is not reached.
 */
export function nextEdge(input: NextEdgeInput): NextEdge {
	const { flow, from, outcome, traversals } = input;
	const edges = flow.edges.filter(
		(edge) => edge.from === from && edge.outcome === outcome,
	);
	if (edges.length === 0) return { kind: "end" };
	const edge = edges.find(
		(candidate) =>
			candidate.max === undefined ||
			(traversals[candidate.id] ?? 0) < candidate.max,
	);
	return edge ? { kind: "edge", edge } : { kind: "exhausted", edges };
}
