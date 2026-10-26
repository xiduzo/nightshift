import type { Flow } from "@nightshift/flows";

/** What a person can ask for first, in a flow that has nothing in it yet. */
export const STARTERS = [
	"Run the tests and fix failures",
	"Turn an issue into a pull request",
	"Review my open pull requests",
] as const;

/** A flow with at most one node and no edges: a new flow, nothing built yet. */
export function isBlankFlow(flow: Pick<Flow, "nodes" | "edges">): boolean {
	return flow.edges.length === 0 && flow.nodes.length <= 1;
}
