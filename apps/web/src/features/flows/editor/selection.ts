// What is selected on the editor's canvas. One node, edge or Section opens
// the inspector. Several nodes and boxes (Shift-drag a box, or Cmd/Ctrl-
// click) can be made into a Section.

import type { Flow } from "@nightshift/flows";
import { sectionIdOf, sectionNodeId } from "../canvas/sections/section-ids";

export type Selection =
	| { kind: "node"; id: string }
	/** Several: nodes, and the boxes of Sections in `sections`, if any. */
	| { kind: "nodes"; ids: string[]; sections?: string[] }
	| { kind: "edge"; id: string }
	| { kind: "section"; id: string }
	| null;

export type SelectionSetter = (
	selection: Selection | ((current: Selection) => Selection),
) => void;

/** The nodes of the flow that are selected. */
export function selectedNodeIds(selection: Selection): string[] {
	if (selection?.kind === "node") return [selection.id];
	if (selection?.kind === "nodes") return selection.ids;
	return [];
}

/** The Sections whose boxes are selected, alone or with others. */
export function selectedSectionIds(selection: Selection): string[] {
	if (selection?.kind === "section") return [selection.id];
	if (selection?.kind === "nodes") return selection.sections ?? [];
	return [];
}

/** The canvas nodes that are selected: nodes of the flow, or Section boxes. */
export function canvasIds(selection: Selection): string[] {
	return [
		...selectedNodeIds(selection),
		...selectedSectionIds(selection).map(sectionNodeId),
	];
}

/**
 * The selection after React Flow selects or unselects canvas nodes. One
 * node or one box alone is that node or Section, more are several. An
 * edge stays selected until React Flow unselects it.
 */
export function applyNodeSelection(
	current: Selection,
	changes: readonly { id: string; selected: boolean }[],
): Selection {
	if (changes.length === 0) return current;
	const ids = new Set(canvasIds(current));
	for (const { id, selected } of changes) {
		if (selected) ids.add(id);
		else ids.delete(id);
	}
	const nodes = [...ids].filter((id) => sectionIdOf(id) === undefined);
	const sections = [...ids].flatMap((id) => sectionIdOf(id) ?? []);
	if (nodes.length + sections.length > 1)
		return sections.length > 0
			? { kind: "nodes", ids: nodes, sections }
			: { kind: "nodes", ids: nodes };
	if (nodes.length === 1) return { kind: "node", id: nodes[0] as string };
	const section = sections[0];
	if (section !== undefined) return { kind: "section", id: section };
	return current?.kind === "edge" ? current : null;
}

/** The selection without nodes that are gone or hidden. */
export function withoutNodes(
	current: Selection,
	gone: ReadonlySet<string>,
): Selection {
	if (current?.kind === "node") return gone.has(current.id) ? null : current;
	if (current?.kind !== "nodes") return current;
	const ids = current.ids.filter((id) => !gone.has(id));
	if (ids.length === current.ids.length) return current;
	const sections = current.sections ?? [];
	if (ids.length + sections.length > 1)
		return sections.length > 0
			? { kind: "nodes", ids, sections }
			: { kind: "nodes", ids };
	if (ids.length === 1) return { kind: "node", id: ids[0] as string };
	const section = sections[0];
	return section === undefined ? null : { kind: "section", id: section };
}

/** The selection without what the flow no longer has, as after an undo. */
export function selectionIn(
	flow: Pick<Flow, "nodes" | "edges" | "sections">,
	current: Selection,
): Selection {
	if (current?.kind === "edge")
		return flow.edges.some((edge) => edge.id === current.id) ? current : null;
	if (current?.kind === "section")
		return flow.sections?.some((section) => section.id === current.id)
			? current
			: null;
	const known = new Set(flow.nodes.map((node) => node.id));
	const kept =
		current?.kind === "nodes" && current.sections
			? {
					...current,
					sections: current.sections.filter((id) =>
						flow.sections?.some((section) => section.id === id),
					),
				}
			: current;
	return withoutNodes(
		kept,
		new Set(selectedNodeIds(current).filter((id) => !known.has(id))),
	);
}
