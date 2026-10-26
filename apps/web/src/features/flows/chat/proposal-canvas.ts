import {
	diffFlows,
	type Flow,
	type FlowDiffSummary,
	flowDiffSummary,
} from "@nightshift/flows";

/** How a node of a proposal differs from the draft, on the canvas. */
export type NodeChangeMark = "added" | "removed" | "changed";
/** How an edge of a proposal differs from the draft, on the canvas. */
export type EdgeChangeMark = "added" | "removed";

/**
 * What the canvas draws while a proposal shows: the proposed flow with the
 * removed nodes and edges of the draft put back as ghosts, and a mark per
 * node and edge id that differs. A node that only moved has no mark.
 */
export type ProposalCanvas = {
	/** What the canvas draws: `proposed` and the ghosts. */
	flow: Flow;
	/** The proposed flow as it is, for its issues. */
	proposed: Flow;
	nodes: ReadonlyMap<string, NodeChangeMark>;
	edges: ReadonlyMap<string, EdgeChangeMark>;
	summary: FlowDiffSummary;
};

export function proposalCanvas(draft: Flow, proposed: Flow): ProposalCanvas {
	const diff = diffFlows(draft, proposed);
	const nodes = new Map<string, NodeChangeMark>();
	for (const node of diff.nodes.added) nodes.set(node.id, "added");
	for (const change of diff.nodes.changed) nodes.set(change.id, "changed");
	for (const node of diff.nodes.removed) nodes.set(node.id, "removed");
	const edges = new Map<string, EdgeChangeMark>();
	for (const edge of diff.edges.added) edges.set(edge.id, "added");
	// A removed edge's id is in no edge of the proposal: the diff pairs equal ids.
	for (const edge of diff.edges.removed) edges.set(edge.id, "removed");
	return {
		flow: {
			...proposed,
			nodes: [...proposed.nodes, ...diff.nodes.removed],
			edges: [...proposed.edges, ...diff.edges.removed],
		},
		proposed,
		nodes,
		edges,
		summary: flowDiffSummary(diff),
	};
}

/** The words of a diff's counts, for one badge each. Empty: nothing but positions changed. */
export function summaryLabels(summary: FlowDiffSummary): string[] {
	const labels: string[] = [];
	const count = (n: number, one: string, many: string) => {
		if (n > 0) labels.push(`${n} ${n === 1 ? one : many}`);
	};
	count(summary.added, "new node", "new nodes");
	count(summary.removed, "removed node", "removed nodes");
	count(summary.changed, "changed node", "changed nodes");
	count(summary.edges, "edge change", "edge changes");
	count(summary.other, "other change", "other changes");
	return labels;
}
