// A Section shows on the canvas as one React Flow node: its frame, or its
// box when folded. Node ids hold no `:`, so the prefix never meets a node.

const PREFIX = "section:";

/** The canvas id of a Section's frame or box. */
export function sectionNodeId(sectionId: string): string {
	return PREFIX + sectionId;
}

/** The Section a canvas id names, or undefined for a node of the flow. */
export function sectionIdOf(canvasId: string): string | undefined {
	return canvasId.startsWith(PREFIX)
		? canvasId.slice(PREFIX.length)
		: undefined;
}
