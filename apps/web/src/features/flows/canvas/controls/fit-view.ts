import type { FitViewOptions } from "@xyflow/react";

/** How the canvas fits the flow into view when no panel covers it. */
export const FIT_VIEW = { maxZoom: 1, padding: 0.15 } satisfies FitViewOptions;

/** The least width the flow keeps beside a panel. Below it the panel covers the canvas anyway. */
const MIN_VISIBLE_PX = 360;

/** Room between the flow and the panel's edge. */
const GAP_PX = 24;

/**
 * Fits the flow into the part of the canvas no panel covers: `coveredRight`
 * pixels of the canvas's right side are under a panel, such as the chat. On
 * a canvas too narrow for the flow beside the panel, it fits the whole
 * canvas, as without a panel.
 */
export function fitViewOptions(
	canvasWidth: number,
	coveredRight: number,
): FitViewOptions {
	if (coveredRight <= 0 || canvasWidth - coveredRight < MIN_VISIBLE_PX)
		return FIT_VIEW;
	return {
		maxZoom: 1,
		padding: {
			top: "15%",
			bottom: "15%",
			left: "10%",
			right: `${coveredRight + GAP_PX}px`,
		},
	};
}
