// The edges the canvas shows: the flow's drawn lines, and the dotted reads of the selected node.

import type { Flow } from "@nightshift/flows";
import { useMemo } from "react";
import {
	canvasEdges,
	type DataCanvasEdge,
	type FlowCanvasEdge,
	isOutsideId,
	type RouteBook,
	sectionIdOf,
	useDataLinks,
	type useOpenSection,
	type useSectionCanvas,
} from "../canvas";
import type { CanvasPreview, useCanvasNodes } from "./canvas-nodes";
import type { Selection } from "./session";

/** The flow's edges, and the dotted lines of the selected node. */
export type CanvasEdge = FlowCanvasEdge | DataCanvasEdge;

/**
 * The edges of the canvas: one drawn line for each pair of nodes, with
 * its errors, and the dotted reads of the selected node under them.
 * `groupOf` finds the edges a drawn line stands for.
 */
export function useCanvasEdges({
	flow,
	sections,
	routes,
	counts,
	selection,
	preview,
	view,
}: {
	flow: Flow;
	sections: ReturnType<typeof useSectionCanvas>;
	routes: RouteBook;
	counts: ReturnType<typeof useCanvasNodes>["counts"];
	selection: Selection;
	preview: CanvasPreview | undefined;
	view: ReturnType<typeof useOpenSection>["view"];
}) {
	const { groups, boxPositions } = sections;
	const edges = useMemo<FlowCanvasEdge[]>(
		() =>
			// The whole flow: an edge from outside reads its colour there.
			canvasEdges(flow, groups, {
				routes,
				errors: counts.edgeErrors,
				selected: selection?.kind === "edge" ? selection.id : undefined,
				boxes: boxPositions,
				endOf: sections.endOf,
				changes: preview?.edges,
			}).map((edge) =>
				// A line to a box, or to what lies outside the open Section,
				// stands for edges you cannot see: Delete does not remove
				// them. Select one on its label.
				[edge.source, edge.target].some(
					(end) => sectionIdOf(end) !== undefined || isOutsideId(end),
				)
					? { ...edge, deletable: false }
					: edge,
			),
		[
			flow,
			groups,
			routes,
			counts,
			selection,
			boxPositions,
			sections.endOf,
			preview,
		],
	);
	// The selected node's reads, dotted, under the flow's edges.
	const dataEdges = useDataLinks(
		view,
		!preview && selection?.kind === "node" ? selection.id : null,
		sections.endOf,
	);
	const allEdges = useMemo<CanvasEdge[]>(
		() => (dataEdges.length > 0 ? [...dataEdges, ...edges] : edges),
		[dataEdges, edges],
	);
	// A drawn edge carries every edge of its node pair, under its first id.
	const groupOf = useMemo(
		() => new Map(groups.map((group) => [group.id, group])),
		[groups],
	);
	return { allEdges, groupOf };
}
