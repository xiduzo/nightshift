import type { Flow, FlowEdge, Outcome } from "./flow";

export type NextEdgeInput = {
	flow: Flow;
	from: string;
	outcome: Outcome;
	/** How often the run took each edge so far, by edge id. */
	traversals: Readonly<Record<string, number>>;
};

export type NextEdge =
	| { kind: "edge"; edge: FlowEdge }
	/** No edge leaves the node on this outcome: the flow ends here. */
	| { kind: "end" }
	/** Edges exist, but every one hit its max. */
	| { kind: "exhausted"; edges: FlowEdge[] };

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
