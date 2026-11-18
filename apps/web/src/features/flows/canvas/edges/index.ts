/**
 * The edges of the canvas: one edge per pair of nodes, its route, and the
 * routes kept between visits.
 */

export {
	type EdgeGroup,
	exitHandleId,
	groupEdges,
	groupSegments,
	labelAtRest,
	labelText,
	pairKey,
	segmentIndex,
} from "./edge-groups";
export type { EdgeRoute, Point } from "./edge-route";
export {
	canvasEdges,
	edgeTypes,
	type FlowCanvasEdge,
	OutcomeMarkers,
	SelectEdgeContext,
} from "./outcome-edge";
export {
	type EndOf,
	type RouteBook,
	readRoutes,
	recordRoutes,
	writeRoutes,
} from "./route-cache";
