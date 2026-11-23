// "Lay out": every node of the flow moves to a place ELK picks, and Undo puts them back.

import type { Flow } from "@nightshift/flows";
import { moveNodes, sectionLevel } from "@nightshift/flows";
import { type useReactFlow, useStoreApi } from "@xyflow/react";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import {
	type CanvasNode,
	type fitViewOptions,
	groupEdges,
	layoutFlow,
	loadElk,
	type RouteBook,
	recordRoutes,
	sectionEnds,
	sectionIds,
	type useMeasured,
	writeRoutes,
} from "../../canvas";
import type { CanvasEdge } from "./canvas-edges";
import { measuredHandles } from "./measured-handles";

/**
 * "Lay out" for the canvas: it moves every node, keeps the routes of the
 * layout in this browser, and offers Undo in its toast.
 */
export function useAutoLayout({
	flow,
	routes,
	setRoutes,
	routesKey,
	measured,
	onFlowChange,
	fitView,
	fit,
}: {
	flow: Flow;
	routes: RouteBook;
	setRoutes: Dispatch<SetStateAction<RouteBook>>;
	routesKey: string;
	measured: ReturnType<typeof useMeasured>[0];
	onFlowChange: (change: (flow: Flow) => Flow, gesture?: string) => void;
	fitView: ReturnType<typeof useReactFlow>["fitView"];
	fit: ReturnType<typeof fitViewOptions>;
}) {
	// Every node moves at once, so the toast offers the old places back. Fit
	// after React Flow has the new positions: a layout you cannot see looks
	// like nothing happened. The layout picks the direction that shows the
	// nodes biggest in the canvas the fit will show, less its padding.
	const store = useStoreApi<CanvasNode, CanvasEdge>();
	const laying = useRef(false);
	const autoLayout = useCallback(async () => {
		if (laying.current) return;
		laying.current = true;
		const before = new Map(flow.nodes.map((node) => [node.id, node.position]));
		const routesBefore = routes;
		const { width, height, nodeLookup } = store.getState();
		const viewport = { width: width / 1.15, height: height / 1.15 };
		try {
			// A Section is one box: the layout lays its nodes out inside, and
			// their top-left corner lands where it put the box.
			const folded = sectionIds(flow);
			const laid = await layoutFlow(flow, {
				layout: await loadElk(),
				sizes: measured,
				...measuredHandles(nodeLookup),
				folded,
				viewport,
			});
			const at = new Map(
				laid.flow.nodes.map((node) => [node.id, node.position]),
			);
			const laidGroups = groupEdges(laid.flow);
			// Each route with the ends of the level that draws it: the boxes
			// of the Sections it shows, also while another level is open.
			const endsOf = (level: Flow) => sectionEnds(level, sectionIds(level));
			const book = Object.assign(
				{},
				// Inside a Section, the routes hold once it opens.
				...laid.inside.map((level) =>
					recordRoutes(
						laid.flow.nodes,
						laidGroups,
						level.routes,
						endsOf(level.flow),
					),
				),
				recordRoutes(
					laid.flow.nodes,
					laidGroups,
					laid.routes,
					endsOf(sectionLevel(flow, null)),
				),
			);
			setRoutes(book);
			writeRoutes(routesKey, book);
			onFlowChange((current) => moveNodes(current, at));
		} catch {
			toast.error("Could not lay out the flow. Try again.");
			return;
		} finally {
			laying.current = false;
		}
		requestAnimationFrame(() => void fitView({ ...fit, duration: 200 }));
		toast.info("Laid out the flow.", {
			action: {
				label: "Undo",
				onClick: () => {
					setRoutes(routesBefore);
					writeRoutes(routesKey, routesBefore);
					onFlowChange((current) => moveNodes(current, before));
				},
			},
		});
	}, [
		flow,
		routes,
		routesKey,
		measured,
		onFlowChange,
		fitView,
		fit,
		store,
		setRoutes,
	]);
	return { autoLayout };
}
