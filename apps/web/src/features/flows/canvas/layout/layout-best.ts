import type { Direction, ElkLayout } from "./elk-graph";
import { candidateOptions, elkGraph } from "./elk-graph";
import type { Box, LayoutGraph, Size } from "./layout-graph";
import type { Laid } from "./read-layout";
import { readLayout } from "./read-layout";

/** Another direction must make the nodes this much bigger on screen to be
 *  worth it. A flow reads best left to right, so a near tie stays there. */
const GAIN = 1.1;

/** The zoom a fit would land on, capped where the canvas stops zooming in. */
export function fitZoom(boxes: Map<string, Box>, viewport: Size): number {
	const all = [...boxes.values()];
	const width =
		Math.max(...all.map((box) => box.x + box.width)) -
		Math.min(...all.map((box) => box.x));
	const height =
		Math.max(...all.map((box) => box.y + box.height)) -
		Math.min(...all.map((box) => box.y));
	return Math.min(1, viewport.width / width, viewport.height / height);
}

/**
 * Lay out the graph in each direction and keep the one whose nodes show
 * biggest in the viewport. Left to right wins a near tie. Without a
 * viewport, left to right it is. The direction is the top level's: open
 * Sections run left to right inside.
 */
export async function layoutBest(
	layout: ElkLayout,
	graph: LayoutGraph,
	viewport?: Size,
): Promise<Laid & { direction: Direction }> {
	const directions: Direction[] = viewport
		? ["right", "wrapped", "down"]
		: ["right"];
	let best: (Laid & { direction: Direction; zoom: number }) | undefined;
	for (const direction of directions) {
		const laid = readLayout(
			await layout(elkGraph(graph, candidateOptions(direction, viewport))),
			graph,
		);
		const zoom = viewport ? fitZoom(laid.boxes, viewport) : 1;
		if (!best || zoom > best.zoom * GAIN) best = { ...laid, direction, zoom };
	}
	const { zoom: _, ...laid } = best as NonNullable<typeof best>;
	return laid;
}
