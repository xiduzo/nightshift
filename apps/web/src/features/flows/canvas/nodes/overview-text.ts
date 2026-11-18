import { type ReactFlowState, useStore } from "@xyflow/react";

/** Below this zoom a node's text is too small to read, so the node shows its
 *  type and id in large type instead, and a big flow reads as an overview. */
const OVERVIEW_ZOOM = 0.55;
/** The id's size on screen in the overview, and the most it may take up in
 *  the node. */
const OVERVIEW_TEXT = 14;
const OVERVIEW_TEXT_MAX = 44;

/** The zoom in steps of 0.05 below `OVERVIEW_ZOOM`, else null: a node redraws
 *  a few times in a zoom gesture, not on every frame. */
function overviewZoom(state: ReactFlowState): number | null {
	const zoom = state.transform[2];
	return zoom < OVERVIEW_ZOOM
		? Math.max(0.05, Math.round(zoom * 20) / 20)
		: null;
}

/**
 * The font size, in canvas pixels, that reads as `OVERVIEW_TEXT` on screen
 * when zoomed out to the overview (at most `max`). Zero when zoomed in.
 */
export function useOverviewText(max = OVERVIEW_TEXT_MAX): number {
	const overview = useStore(overviewZoom);
	return overview ? Math.min(OVERVIEW_TEXT / overview, max) : 0;
}
