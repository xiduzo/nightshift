// Where a Section shows on the canvas: one box at the top-left corner of
// its members. Its place is not stored, so the box follows its members, and
// moving the box moves the members. Positions in the flow file stay per node.

import { type Flow, type FlowSection, moveNode } from "@nightshift/flows";
import type { Point } from "../edge-route";
import type { Measured } from "../use-measured";

/** A node React Flow has not measured yet: `w-64` and a typical body. */
const FALLBACK_SIZE = { width: 256, height: 160 };

export type Rect = Point & { width: number; height: number };

/** The box around the nodes, by their positions and sizes. Null for no known node. */
export function membersBounds(
	flow: Pick<Flow, "nodes">,
	nodeIds: readonly string[],
	sizes: Measured = {},
): Rect | null {
	const members = new Set(nodeIds);
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const node of flow.nodes) {
		if (!members.has(node.id)) continue;
		const size = sizes[node.id] ?? FALLBACK_SIZE;
		left = Math.min(left, node.position.x);
		top = Math.min(top, node.position.y);
		right = Math.max(right, node.position.x + size.width);
		bottom = Math.max(bottom, node.position.y + size.height);
	}
	if (left === Number.POSITIVE_INFINITY) return null;
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Where a Section's box is: the top-left corner of its members. */
export function boxPosition(
	flow: Pick<Flow, "nodes">,
	section: FlowSection,
): Point | null {
	const bounds = membersBounds(flow, section.nodes);
	return bounds ? { x: bounds.x, y: bounds.y } : null;
}

/**
 * How far the members move when the Section's box is dragged to `to`, from
 * where the flow has it now. Null when the Section has no node on the canvas.
 */
export function sectionDragDelta(
	flow: Pick<Flow, "nodes">,
	section: FlowSection,
	to: Point,
): Point | null {
	const from = boxPosition(flow, section);
	return from ? { x: to.x - from.x, y: to.y - from.y } : null;
}

/** Moves every member of the Section by `delta`, as one block. */
export function moveSection(
	flow: Flow,
	section: FlowSection,
	delta: Point,
): Flow {
	if (delta.x === 0 && delta.y === 0) return flow;
	const members = new Set(section.nodes);
	return flow.nodes.reduce(
		(next, node) =>
			members.has(node.id)
				? moveNode(next, node.id, {
						x: node.position.x + delta.x,
						y: node.position.y + delta.y,
					})
				: next,
		flow,
	);
}
