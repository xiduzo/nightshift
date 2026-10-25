// What is selected on the editor's canvas. One node, edge or Section opens
// the inspector. Several nodes (Shift-drag a box, or Cmd/Ctrl-click) can be
// made into a Section.

import { sectionIdOf, sectionNodeId } from "../canvas/sections/section-ids";

export type Selection =
	| { kind: "node"; id: string }
	| { kind: "nodes"; ids: string[] }
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

/** The canvas nodes that are selected: nodes of the flow, or a Section's frame or box. */
function canvasIds(selection: Selection): string[] {
	if (selection?.kind === "section") return [sectionNodeId(selection.id)];
	return selectedNodeIds(selection);
}

/**
 * The selection after React Flow selects or unselects canvas nodes. Nodes
 * win over Sections: a box drawn around a frame and its nodes selects the
 * nodes. An edge stays selected until React Flow unselects it.
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
	if (nodes.length === 1) return { kind: "node", id: nodes[0] as string };
	if (nodes.length > 1) return { kind: "nodes", ids: nodes };
	const section = sections.at(-1);
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
	if (ids.length === 0) return null;
	return ids.length === 1
		? { kind: "node", id: ids[0] as string }
		: { kind: "nodes", ids };
}
