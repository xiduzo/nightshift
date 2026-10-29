import { isFanOut } from "./branches";
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
	/** Several edges without a max: the run takes every one of them at once. */
	| { kind: "fan-out"; edges: FlowEdge[] }
	/** No edge leaves the node on this outcome: the flow ends here. */
	| { kind: "end" }
	/** Edges exist, but every one hit its max. */
	| { kind: "exhausted"; edges: FlowEdge[] };

/**
 * The edge a run takes after a node ends with an outcome: the first edge (in
 * file order) from that node on that outcome whose `max` is not reached.
 * When several edges on the outcome have no max, the run takes them all
 * (a fan-out, `isFanOut`).
 */
export function nextEdge(input: NextEdgeInput): NextEdge {
	const { flow, from, outcome, traversals } = input;
	const edges = flow.edges.filter(
		(edge) => edge.from === from && edge.outcome === outcome,
	);
	if (edges.length === 0) return { kind: "end" };
	if (isFanOut(edges)) {
		return {
			kind: "fan-out",
			edges: edges.filter((edge) => edge.max === undefined),
		};
	}
	const edge = edges.find(
		(candidate) =>
			candidate.max === undefined ||
			(traversals[candidate.id] ?? 0) < candidate.max,
	);
	return edge ? { kind: "edge", edge } : { kind: "exhausted", edges };
}
