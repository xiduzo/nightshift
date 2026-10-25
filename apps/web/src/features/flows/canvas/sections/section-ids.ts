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
