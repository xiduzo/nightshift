// A folded Section is one box. The edges into it lead to the box, the
// edges out of it leave the box from one handle per node and outcome, and
// the edges inside it do not show. One drawn edge per pair of canvas nodes
// still holds: two outside edges into the box from one node are one line.

import { type Flow, type FlowEdge, nodeOutcomes } from "@nightshift/flows";
import { type EdgeGroup, pairKey } from "../edge-groups";
import type { EndOf } from "../route-cache";
import { sectionNodeId } from "./section-ids";

/**
 * The folded Section that holds each node, by node id, as the canvas id
 * of its box. A node in no folded Section is not in the map.
 */
export function foldedMembers(
	flow: Pick<Flow, "sections">,
	folded: ReadonlySet<string>,
): Map<string, string> {
	const boxOf = new Map<string, string>();
	for (const section of flow.sections ?? []) {
		if (!folded.has(section.id)) continue;
		for (const node of section.nodes) {
			// A node two Sections hold stays with the first (as validation says).
			if (!boxOf.has(node)) boxOf.set(node, sectionNodeId(section.id));
		}
	}
	return boxOf;
}

/** What each node is drawn as, for kept routes: itself, or its folded box. */
export function sectionEnds(
	flow: Pick<Flow, "sections">,
	folded: ReadonlySet<string>,
): EndOf {
	const boxOf = foldedMembers(flow, folded);
	return (nodeId) => boxOf.get(nodeId) ?? nodeId;
}

/**
 * The drawn edges with the folded Sections as boxes. A group whose source
 * is a box holds edges of several nodes: they come in the order the box
 * shows its handles, by node in the flow and then by the node's outcomes.
 * Without folded Sections, the groups come back as they are.
 */
export function foldEdgeGroups(
	flow: Pick<Flow, "nodes" | "sections">,
	groups: readonly EdgeGroup[],
	folded: ReadonlySet<string>,
): readonly EdgeGroup[] {
	const boxOf = foldedMembers(flow, folded);
	if (boxOf.size === 0) return groups;
	const end = (node: string) => boxOf.get(node) ?? node;
	const pairOf = new Map<string, EdgeGroup>();
	for (const group of groups) {
		for (const edge of group.edges) pairOf.set(edge.id, group);
	}

	const pairs = new Map<
		string,
		{ from: string; to: string; edges: FlowEdge[] }
	>();
	for (const group of groups) {
		for (const edge of group.edges) {
			const from = end(edge.from);
			const to = end(edge.to);
			// Inside one folded Section: hidden with its nodes.
			if (from === to && boxOf.has(edge.from)) continue;
			const key = pairKey(from, to);
			const pair = pairs.get(key);
			if (pair) pair.edges.push(edge);
			else pairs.set(key, { from, to, edges: [edge] });
		}
	}

	const index = new Map(flow.nodes.map((node, at) => [node.id, at]));
	const rank = new Map<string, number>();
	const order = (edge: FlowEdge) => {
		const key = `${edge.from}\u0000${edge.outcome}`;
		const known = rank.get(key);
		if (known !== undefined) return known;
		const node = flow.nodes[index.get(edge.from) ?? -1];
		const outcomes = node ? nodeOutcomes(node) : [];
		const at = outcomes.indexOf(edge.outcome);
		// Unknown outcomes last within their node.
		const value =
			(index.get(edge.from) ?? flow.nodes.length) * 1000 +
			(at === -1 ? 999 : at);
		rank.set(key, value);
		return value;
	};

	return [...pairs.entries()].map(([key, { from, to, edges }]) => {
		const sorted = [...edges].sort((a, b) => order(a) - order(b));
		const first = sorted[0] as FlowEdge;
		const routedAs = pairOf.get(first.id);
		return {
			id: first.id,
			key,
			from,
			to,
			edges: sorted,
			...(routedAs && routedAs.key !== key && { routedAs }),
		};
	});
}
