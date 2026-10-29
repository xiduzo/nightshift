import type { FlowListItem } from "./types";

/**
 * Whether a flow in the list can start a run: it loads, and it has no
 * errors. Every screen that starts a flow, or lets a schedule start it,
 * asks this.
 */
export function canStart(
	flow: Pick<FlowListItem, "nodeCount" | "errorCount">,
): boolean {
	return flow.nodeCount !== null && flow.errorCount === 0;
}
