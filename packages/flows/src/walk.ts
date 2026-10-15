import type { NextEdge, NextEdgeInput } from "./types";

/**
 * The edge a run takes after a node ends with an outcome: the first edge (in
 * file order) from that node on that outcome whose `max` is not reached.
 */
export function nextEdge(input: NextEdgeInput): NextEdge {
	throw new Error("Not implemented");
}
