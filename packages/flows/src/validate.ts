import type { Flow } from "./schema";
import type { FlowIssue } from "./types";

/**
 * Checks what the schema cannot: unique ids, a known start node, edges between
 * known nodes with outcomes the source node can produce, an Agent node with a
 * prompt or a skill, template references to known nodes and fields, and no
 * cycle without an edge that has a `max`. Warns about unreachable nodes.
 */
export function validateFlow(flow: Flow): FlowIssue[] {
	throw new Error("Not implemented");
}

/** Parses unknown JSON and validates it. Schema errors come back as issues. */
export function parseFlow(
	json: unknown,
): { flow: Flow; issues: FlowIssue[] } | { flow: null; issues: FlowIssue[] } {
	throw new Error("Not implemented");
}
