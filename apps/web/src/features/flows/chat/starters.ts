import type { Flow } from "@nightshift/flows";

/** What a person can ask for first, in a flow that has nothing in it yet. */
export const STARTERS = [
	"Watch a topic and tell me what is new",
	"Find three options and let me pick one",
	"Summarize a web page every morning",
	"Run the tests and fix failures",
] as const;

/** A flow with at most one node and no edges: a new flow, nothing built yet. */
export function isBlankFlow(flow: Pick<Flow, "nodes" | "edges">): boolean {
	return flow.edges.length === 0 && flow.nodes.length <= 1;
}
