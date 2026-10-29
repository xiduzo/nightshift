/** Copy and paste of nodes: within one flow, or from one flow into another. */
import type { Flow, FlowEdge, FlowNode, FlowSection } from "../flow";
import { nodesWithin } from "../sections";
import { uniqueEdgeId, uniqueNodeId } from "./names";
import type { Position } from "./nodes";
import { rewriteRefs, rewriteTemplates } from "./refs";
import { uniqueSectionId } from "./sections";

/**
 * Nodes as they were copied: the edges between them, and the Sections
 * they fill completely, with the Sections inside those. Edges to nodes
 * that were not copied stay behind.
 */
export type FlowClip = {
	nodes: FlowNode[];
	edges: FlowEdge[];
	sections: FlowSection[];
};

/** The nodes `ids` of the flow, in flow order. Null when none of them is in it. */
export function copyNodes(flow: Flow, ids: readonly string[]): FlowClip | null {
	const wanted = new Set(ids);
	const nodes = flow.nodes.filter((node) => wanted.has(node.id));
	if (nodes.length === 0) return null;
	const copied = new Set(nodes.map((node) => node.id));
	return {
		nodes,
		edges: flow.edges.filter(
			(edge) => copied.has(edge.from) && copied.has(edge.to),
		),
		sections: copiedSections(flow, copied),
	};
}

/** The Sections whose nodes were all copied, holding only copied Sections. */
function copiedSections(
	flow: Flow,
	copied: ReadonlySet<string>,
): FlowSection[] {
	const whole = (flow.sections ?? []).filter((section) => {
		const nodes = nodesWithin(flow, section);
		return nodes.length > 0 && nodes.every((id) => copied.has(id));
	});
	const kept = new Set(whole.map((section) => section.id));
	return whole.map((section) => {
		const { sections: inner, ...rest } = section;
		const sections = (inner ?? []).filter((id) => kept.has(id));
		return sections.length > 0 ? { ...rest, sections } : rest;
	});
}

/**
 * Adds the clip's nodes to the flow, moved by `offset`. A name the flow
 * already uses gets a free one (`review` → `review_2`), and the edges,
 * Sections and templates of the pasted nodes follow it. The first node of
 * an empty flow becomes its start. Returns the ids of the pasted nodes.
 */
export function pasteNodes(
	flow: Flow,
	clip: FlowClip,
	offset: Position = { x: 0, y: 0 },
): { flow: Flow; ids: string[] } {
	const names = new Map<string, string>();
	let next: Flow = flow;
	// One by one, so two pasted nodes never take the same free name.
	for (const node of clip.nodes) {
		const id = uniqueNodeId(next, node.id);
		names.set(node.id, id);
		next = {
			...next,
			nodes: [
				...next.nodes,
				{
					...node,
					id,
					position: {
						x: Math.round(node.position.x + offset.x),
						y: Math.round(node.position.y + offset.y),
					},
				},
			],
		};
	}
	const pasted = new Set(names.values());
	// The pasted nodes read each other under their new names.
	const renamed = (text: string) =>
		rewriteRefs(text, (ref) => {
			const to = names.get(ref.name);
			if (to === undefined || to === ref.name) return undefined;
			const at = ref.raw.indexOf(ref.name);
			return ref.raw.slice(0, at) + to + ref.raw.slice(at + ref.name.length);
		});
	next = {
		...next,
		nodes: next.nodes.map((node) =>
			pasted.has(node.id) ? rewriteTemplates(node, renamed) : node,
		),
	};
	for (const edge of clip.edges) {
		const from = names.get(edge.from);
		const to = names.get(edge.to);
		if (from === undefined || to === undefined) continue;
		const id = uniqueEdgeId(next, `${from}-${edge.outcome}-${to}`);
		next = { ...next, edges: [...next.edges, { ...edge, id, from, to }] };
	}
	// A pasted Section has no edge in yet: the issues ask for one, as they
	// do for a Section whose nodes no longer form one.
	const sectionNames = new Map<string, string>();
	for (const section of clip.sections) {
		const id = uniqueSectionId(next, section.id);
		sectionNames.set(section.id, id);
		const nodes = section.nodes.flatMap((node) => names.get(node) ?? []);
		next = {
			...next,
			sections: [...(next.sections ?? []), { ...section, id, nodes }],
		};
	}
	// The pasted Sections hold each other under their new ids.
	if (clip.sections.some((section) => section.sections)) {
		const pastedIds = new Set(sectionNames.values());
		next = {
			...next,
			sections: (next.sections ?? []).map((section) =>
				pastedIds.has(section.id) && section.sections
					? {
							...section,
							sections: section.sections.flatMap(
								(id) => sectionNames.get(id) ?? [],
							),
						}
					: section,
			),
		};
	}
	const ids = [...names.values()];
	if (flow.nodes.length === 0 && ids[0] !== undefined)
		next = { ...next, start: ids[0] };
	return { flow: next, ids };
}
