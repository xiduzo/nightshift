/**
 * Sections inside Sections. A Section lists the nodes it holds itself and
 * the Sections inside it (`FlowSection.sections`). A node is in the lowest
 * Section that holds it, and only there. These helpers read the nesting;
 * they never loop, also when a file lists a Section inside itself.
 */
import type { Flow, FlowSection } from "../flow";

type Sections = Pick<Flow, "sections">;

/** The Section with this id, if the flow has one. */
export function findSection(
	flow: Sections,
	id: string,
): FlowSection | undefined {
	return (flow.sections ?? []).find((section) => section.id === id);
}

/** The Section that holds the Section `id` directly: the first that lists it. */
export function parentSection(
	flow: Sections,
	id: string,
): FlowSection | undefined {
	return (flow.sections ?? []).find(
		(section) => section.id !== id && (section.sections ?? []).includes(id),
	);
}

/** The Sections that no other Section holds, in file order. */
export function topSections(flow: Sections): FlowSection[] {
	return (flow.sections ?? []).filter(
		(section) => parentSection(flow, section.id) === undefined,
	);
}

/** The Sections directly inside `section`, in its order. Unknown ids are left out. */
export function childSections(
	flow: Sections,
	section: FlowSection,
): FlowSection[] {
	return (section.sections ?? []).flatMap((id) => {
		const child = findSection(flow, id);
		return child && child.id !== section.id ? [child] : [];
	});
}

/** Every Section inside `section`, at any depth, outer ones first. */
export function sectionsWithin(
	flow: Sections,
	section: FlowSection,
): FlowSection[] {
	const seen = new Set([section.id]);
	const found: FlowSection[] = [];
	const queue = [section];
	for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
		for (const child of childSections(flow, at)) {
			if (seen.has(child.id)) continue;
			seen.add(child.id);
			found.push(child);
			queue.push(child);
		}
	}
	return found;
}

/**
 * Every node in `section`: its own, and those of the Sections inside it.
 * In the order of the nodes in the flow when `flow` has nodes, else in
 * the order found.
 */
export function nodesWithin(
	flow: Pick<Flow, "sections"> & Partial<Pick<Flow, "nodes">>,
	section: FlowSection,
): string[] {
	const ids = new Set([
		...section.nodes,
		...sectionsWithin(flow, section).flatMap((inner) => inner.nodes),
	]);
	if (!flow.nodes) return [...ids];
	return flow.nodes.map((node) => node.id).filter((id) => ids.has(id));
}

/**
 * The Sections around the Section `id`, outermost first, ending with the
 * Section itself. Empty when the flow has no such Section.
 */
export function sectionPath(flow: Sections, id: string): FlowSection[] {
	const path: FlowSection[] = [];
	const seen = new Set<string>();
	for (
		let at = findSection(flow, id);
		at !== undefined && !seen.has(at.id);
		at = parentSection(flow, at.id)
	) {
		seen.add(at.id);
		path.unshift(at);
	}
	return path;
}

/**
 * What one level of the nesting shows: the whole flow (`id` null) or the
 * inside of the Section `id`. Its nodes are every node at that level and
 * below, its edges those between them. Its `sections` are the Sections
 * directly at that level, each with every node inside it as its own and
 * no `sections`: one box each. Its start stays the flow's start. A
 * Section the flow does not have shows the whole flow.
 */
export function sectionLevel(flow: Flow, id: string | null): Flow {
	const open = id === null ? undefined : findSection(flow, id);
	const flat = (section: FlowSection): FlowSection => {
		const { sections: _, ...rest } = section;
		return { ...rest, nodes: nodesWithin(flow, section) };
	};
	if (!open) {
		const top = topSections(flow).map(flat);
		const { sections: _, ...rest } = flow;
		return top.length > 0 ? { ...rest, sections: top } : rest;
	}
	const members = new Set(nodesWithin(flow, open));
	const inner = childSections(flow, open).map(flat);
	const { sections: _, ...rest } = flow;
	return {
		...rest,
		nodes: flow.nodes.filter((node) => members.has(node.id)),
		edges: flow.edges.filter(
			(edge) => members.has(edge.from) && members.has(edge.to),
		),
		...(inner.length > 0 && { sections: inner }),
	};
}
