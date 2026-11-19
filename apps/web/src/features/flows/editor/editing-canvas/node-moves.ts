// The flow after the moves and removes of one change on the canvas.

import type { Flow } from "@nightshift/flows";
import { moveNodes, nodesWithin, removeNode } from "@nightshift/flows";
import { moveSection, sectionDragDelta } from "../../canvas";

/** The moves and removes of one change React Flow reports. */
export type NodeMoves = {
	/** Section boxes dragged to a new top-left corner, by Section id. */
	sectionMoves: ReadonlyMap<string, { x: number; y: number }>;
	/** Nodes moved to a new place. */
	moves: readonly { id: string; position: { x: number; y: number } }[];
	/** Nodes removed. */
	removed: readonly string[];
};

/**
 * `current` with the moves and removes of one change. A dragged box moves
 * the nodes of its Section, and of the Sections inside it, as one block: a
 * move of one of those nodes in the same change does not count.
 */
export function withNodeChanges(
	current: Flow,
	{ sectionMoves, moves, removed }: NodeMoves,
): Flow {
	let next = current;
	// Dragging a box moves its nodes as one block, from where
	// they are now.
	const carried = new Set<string>();
	for (const [sectionId, to] of sectionMoves) {
		const found = next.sections?.find((s) => s.id === sectionId);
		if (!found) continue;
		// With the nodes of the Sections inside it.
		const section = { ...found, nodes: nodesWithin(next, found) };
		const delta = sectionDragDelta(next, section, to);
		if (delta) next = moveSection(next, section, delta);
		for (const id of section.nodes) carried.add(id);
	}
	if (moves.length > 0) {
		const positions = new Map<string, { x: number; y: number }>();
		for (const { id, position } of moves) {
			if (!carried.has(id)) positions.set(id, position);
		}
		next = moveNodes(next, positions);
	}
	for (const id of removed) next = removeNode(next, id);
	return next;
}
