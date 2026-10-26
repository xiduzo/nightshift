// A Section shows on the canvas as one React Flow node: its frame, or its
// box when folded, under the id "Lay out" gives it (`section:<id>`), so the
// layout's boxes, handles and routes line up with the canvas. Node ids hold
// no `:`, so the prefix never meets a node.

import { sectionNodeId } from "../../editor/lib/flow-layout";

export { sectionNodeId };

const PREFIX = sectionNodeId("");

/** The Section a canvas id names, or undefined for a node of the flow. */
export function sectionIdOf(canvasId: string): string | undefined {
	return canvasId.startsWith(PREFIX)
		? canvasId.slice(PREFIX.length)
		: undefined;
}

const OUTSIDE_PREFIX = "outside:";

/**
 * The canvas id of what lies outside an open Section, on the side its
 * edges come in (`in`) or go out (`out`). `end` is how the level around
 * draws it: a node id or a box's canvas id.
 */
export function outsideNodeId(side: "in" | "out", end: string): string {
	return `${OUTSIDE_PREFIX}${side}:${end}`;
}

/** Whether a canvas id names something outside the open Section. */
export function isOutsideId(canvasId: string): boolean {
	return canvasId.startsWith(OUTSIDE_PREFIX);
}
