import type { Flow, FlowIssue, FlowNodeType, Outcome } from "@nightshift/flows";
import {
	addEdge,
	type FlowCheck,
	moveNode,
	nodesWithin,
	removeEdge,
	removeNode,
	sectionBoundary,
	sectionLevel,
	sectionPath,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Kbd, KbdGroup } from "@nightshift/ui/components/kbd";
import {
	Background,
	BackgroundVariant,
	type Connection,
	type EdgeChange,
	type InternalNode,
	type IsValidConnection,
	MiniMap,
	type NodeChange,
	NodeToolbar,
	Position,
	ReactFlow,
	useNodesInitialized,
	useReactFlow,
	useStore,
	useStoreApi,
} from "@xyflow/react";
import { GroupIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { exitHandleId, groupEdges } from "../canvas/edge-groups";
import type { DiffMark, FlowCanvasNode } from "../canvas/flow-node";
import {
	canvasEdges,
	edgeTypes,
	type FlowCanvasEdge,
	OutcomeMarkers,
	SelectEdgeContext,
} from "../canvas/outcome-edge";
import {
	type RouteBook,
	readRoutes,
	recordRoutes,
	writeRoutes,
} from "../canvas/route-cache";
import { sectionEnds } from "../canvas/sections/folded-edges";
import { useOpenSection } from "../canvas/sections/section-focus";
import {
	moveSection,
	sectionDragDelta,
} from "../canvas/sections/section-geometry";
import { isOutsideId, sectionIdOf } from "../canvas/sections/section-ids";
import {
	type CanvasNode,
	canvasNodeTypes,
	SectionActionsContext,
	type SectionBoxData,
} from "../canvas/sections/section-nodes";
import { OpenSectionBar, SectionZoom } from "../canvas/sections/section-zoom";
import {
	sectionIds,
	useSectionCanvas,
} from "../canvas/sections/use-section-canvas";
import { useMeasured } from "../canvas/use-measured";
import { CanvasControls } from "./canvas-controls";
import { fitViewOptions } from "./fit-view";
import { loadElk } from "./lib/elk";
import { layoutFlow, type NodeHandles, type Size } from "./lib/flow-layout";
import { isNodeType, NODE_DRAG_TYPE } from "./node-dock";
import {
	applyNodeSelection,
	canvasIds,
	type Selection,
	type SelectionSetter,
	selectedNodeIds,
	selectedSectionIds,
	withoutNodes,
} from "./selection";

/** The keys that delete what is selected. */
const DELETE_KEYS = ["Backspace", "Delete"];

/** How the nodes and edges of a proposed flow differ from the draft, by id. */
export type CanvasPreview = {
	nodes: ReadonlyMap<string, DiffMark>;
	edges: ReadonlyMap<string, "added" | "removed">;
};

/** One empty list for every node without issues, so its data stays the same. */
const NO_ISSUES: FlowIssue[] = [];

/**
 * Where React Flow measured each node's handles, from the node's top-left
 * corner, and each box's size and handles, by Section id. Only the
 * height counts: inputs sit on the left side of a node and outcomes on its
 * right. A box names its exits as the layout does ("verdict · pass").
 */
function measuredHandles(
	nodeLookup: ReadonlyMap<string, InternalNode<CanvasNode>>,
) {
	const handles: Record<string, NodeHandles> = {};
	const sectionHandles: Record<string, NodeHandles> = {};
	const sectionSizes: Record<string, Size> = {};
	for (const [id, node] of nodeLookup) {
		const bounds = node.internals.handleBounds;
		const { width, height } = node.measured;
		if (!bounds || width === undefined) continue;
		const labels =
			node.type === "sectionBox"
				? new Map(
						(node.data as SectionBoxData).exits.map((exit) => [
							exitHandleId(exit.from, exit.outcome),
							exit.label,
						]),
					)
				: undefined;
		const input = bounds.target?.[0];
		const measuredHandles: NodeHandles = {
			input: input ? { x: 0, y: input.y + input.height / 2 } : undefined,
			outcomes: Object.fromEntries(
				(bounds.source ?? []).flatMap((handle) => {
					const name =
						handle.id && (labels ? labels.get(handle.id) : handle.id);
					return name
						? [[name, { x: width, y: handle.y + handle.height / 2 }]]
						: [];
				}),
			),
		};
		const sectionId = sectionIdOf(id);
		if (sectionId === undefined) {
			handles[id] = measuredHandles;
			continue;
		}
		sectionHandles[sectionId] = measuredHandles;
		if (height !== undefined) sectionSizes[sectionId] = { width, height };
	}
	return { handles, sectionHandles, sectionSizes };
}

const MINI_MAP_COLOR =
	"color-mix(in oklch, var(--muted-foreground) 45%, transparent)";

export function EditorCanvas({
	flow,
	routesKey,
	check,
	selection,
	onFlowChange,
	onSelect,
	onMakeSection,
	onDropNode,
	onNodeDoubleClick,
	openSection,
	onOpenSection,
	flowLabel,
	preview,
	coveredRight = 0,
}: {
	flow: Flow;
	/** Names the flow for the routes this browser keeps of its last layout. */
	routesKey: string;
	check: FlowCheck;
	selection: Selection;
	/** A change, with the gesture it is part of: a drag is one step for Undo. */
	onFlowChange: (change: (flow: Flow) => Flow, gesture?: string) => void;
	onSelect: SelectionSetter;
	/** "Make section" from the selected nodes. */
	onMakeSection: (nodeIds: string[], sectionIds: string[]) => void;
	/** A node type dragged from the dock was dropped at this point of the screen. */
	onDropNode: (type: FlowNodeType, at: { x: number; y: number }) => void;
	/** A node was double-clicked, for example a Subflow to look inside. */
	onNodeDoubleClick?: (nodeId: string) => void;
	/** The Section whose nodes alone show, or null for the whole flow. */
	openSection: string | null;
	onOpenSection: (sectionId: string | null) => void;
	/** What the whole flow is called while a Section is open. */
	flowLabel: string;
	/**
	 * A proposed change on view: `flow` is the proposal, read only, and
	 * these mark how its nodes and edges differ from the draft.
	 */
	preview?: CanvasPreview;
	/** Pixels of the canvas's right side a panel covers: a fit keeps the flow beside it. */
	coveredRight?: number;
}) {
	const [measured, applyDimensions] = useMeasured();
	const { fitView } = useReactFlow();
	const canvasWidth = useStore((state) => state.width);
	const fit = useMemo(
		() => fitViewOptions(canvasWidth, coveredRight),
		[canvasWidth, coveredRight],
	);

	// Fit once more when every node has its size: the first fit runs before
	// the nodes are measured and the panels have their final size.
	const initialized = useNodesInitialized();
	const fitted = useRef(false);
	useEffect(() => {
		if (!initialized || fitted.current) return;
		fitted.current = true;
		const frame = requestAnimationFrame(() => void fitView(fit));
		return () => cancelAnimationFrame(frame);
	}, [initialized, fitView, fit]);

	const counts = useMemo(() => {
		const byNode = new Map<string, FlowIssue[]>();
		const bySection = new Map<string, FlowIssue[]>();
		const edgeErrors = new Set<string>();
		for (const issue of check.issues) {
			if (issue.nodeId) {
				const issues = byNode.get(issue.nodeId) ?? [];
				issues.push(issue);
				byNode.set(issue.nodeId, issues);
			}
			if (issue.sectionId) {
				const issues = bySection.get(issue.sectionId) ?? [];
				issues.push(issue);
				bySection.set(issue.sectionId, issues);
			}
			if (issue.edgeId && issue.severity === "error")
				edgeErrors.add(issue.edgeId);
		}
		return { byNode, bySection, edgeErrors };
	}, [check]);

	// An open Section shows its nodes alone. Edits still go to the whole flow.
	const open = useOpenSection(flow, openSection);
	const view = open.view;
	// Something picked outside the open Section shows the whole flow again.
	useEffect(() => {
		if (!open.section) return;
		const openId = open.section.id;
		const members = new Set(nodesWithin(flow, open.section));
		const outside =
			selection?.kind === "section"
				? !sectionPath(flow, selection.id).some(
						(section) => section.id === openId,
					)
				: [
						...selectedNodeIds(selection).filter((id) => !members.has(id)),
						...selectedSectionIds(selection).filter(
							(id) =>
								!sectionPath(flow, id).some((section) => section.id === openId),
						),
					].length > 0;
		if (outside) onOpenSection(null);
	}, [flow, selection, open.section, onOpenSection]);

	const selectedSections = useMemo(
		() => selectedSectionIds(selection),
		[selection],
	);
	const sections = useSectionCanvas(view, {
		outside: open.section ? { flow, open: open.section.id } : undefined,
		measured,
		editable: !preview,
		issues: counts.bySection,
		selectedSections,
	});
	const { hidden } = sections;

	const nodes = useMemo<CanvasNode[]>(() => {
		const selected = new Set(selectedNodeIds(selection));
		const flowNodes = view.nodes.flatMap((node): FlowCanvasNode[] =>
			// A Section's nodes are not on the canvas at all, so no
			// click, box or key can select or delete them.
			hidden.has(node.id)
				? []
				: [
						{
							id: node.id,
							type: node.type,
							position: node.position,
							measured: measured[node.id],
							selected: !preview && selected.has(node.id),
							data: {
								node,
								isStart: view.start === node.id,
								issues: counts.byNode.get(node.id) ?? NO_ISSUES,
								change: preview?.nodes.get(node.id),
							},
						},
					],
		);
		return [...flowNodes, ...sections.boxes];
	}, [
		view.nodes,
		view.start,
		counts,
		measured,
		selection,
		hidden,
		sections.boxes,
		preview,
	]);

	// The routes of the last "Lay out". Each holds while its nodes stay put.
	const [routes, setRoutes] = useState<RouteBook>(() => readRoutes(routesKey));
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
	// A drawn edge carries every edge of its node pair, under its first id.
	const groupOf = useMemo(
		() => new Map(groups.map((group) => [group.id, group])),
		[groups],
	);

	// Each drag is one gesture, from its first move to the drop.
	const drags = useRef({ count: 0, active: false });

	const onNodesChange = useCallback(
		(changes: NodeChange<CanvasNode>[]) => {
			applyDimensions(changes);
			const sectionMoves = new Map<string, { x: number; y: number }>();
			const moves: { id: string; position: { x: number; y: number } }[] = [];
			let dragging: boolean | undefined;
			for (const change of changes) {
				if (change.type !== "position") continue;
				dragging ||= change.dragging;
				if (!change.position) continue;
				const sectionId = sectionIdOf(change.id);
				if (sectionId !== undefined)
					sectionMoves.set(sectionId, change.position);
				else moves.push({ id: change.id, position: change.position });
			}
			const removed = changes.flatMap((change) =>
				change.type === "remove" && sectionIdOf(change.id) === undefined
					? [change.id]
					: [],
			);
			// A drag is one gesture, and so are moves with the arrow keys.
			let gesture: string | undefined;
			if (dragging !== undefined && removed.length === 0) {
				if (dragging && !drags.current.active)
					drags.current = { count: drags.current.count + 1, active: true };
				gesture = drags.current.active
					? `drag:${drags.current.count}`
					: "nudge";
				if (!dragging) drags.current.active = false;
			}
			if (moves.length > 0 || sectionMoves.size > 0 || removed.length > 0) {
				onFlowChange((current) => {
					let next = current;
					// Dragging a box moves its nodes as one block, from where
					// they are now.
					const carried = new Set<string>();
					for (const [sectionId, to] of sectionMoves) {
						const found = next.sections?.find((s) => s.id === sectionId);
						if (!found) continue;
						// With the nodes of the Sections inside it.
						const section = { ...found, nodes: nodesWithin(next, found) };
						const delta = sectionDragDelta(next, section, to);
						if (delta) next = moveSection(next, section, delta);
						for (const id of section.nodes) carried.add(id);
					}
					for (const { id, position } of moves) {
						if (!carried.has(id)) next = moveNode(next, id, position);
					}
					for (const id of removed) next = removeNode(next, id);
					return next;
				}, gesture);
			}
			const selects = changes.flatMap((change) =>
				change.type === "select"
					? [{ id: change.id, selected: change.selected }]
					: [],
			);
			if (selects.length > 0) {
				onSelect((current) => applyNodeSelection(current, selects));
			}
			if (removed.length > 0) {
				const gone = new Set(removed);
				onSelect((current) => withoutNodes(current, gone));
			}
		},
		[applyDimensions, onFlowChange, onSelect],
	);

	// A box drawn with Shift selects the nodes in it. React Flow selects
	// their edges too: the selection stays the nodes.
	const boxSelecting = useRef(false);

	const onEdgesChange = useCallback(
		(changes: EdgeChange<FlowCanvasEdge>[]) => {
			const ids = (id: string) =>
				groupOf.get(id)?.edges.map((edge) => edge.id) ?? [id];
			const selected = selection?.kind === "edge" ? selection.id : undefined;
			// Delete removes the edge you selected in a drawn edge, or all of
			// them when none is selected (its node went).
			const removed = changes.flatMap((change) => {
				if (change.type !== "remove") return [];
				const inGroup = ids(change.id);
				return selected && inGroup.includes(selected) ? [selected] : inGroup;
			});
			if (removed.length > 0) {
				onFlowChange((current) =>
					removed.reduce((next, id) => removeEdge(next, id), current),
				);
			}
			for (const change of changes) {
				if (change.type !== "select" && change.type !== "remove") continue;
				if (change.type === "select" && boxSelecting.current) continue;
				const inGroup = ids(change.id);
				const isIn = (current: Selection) =>
					current?.kind === "edge" && inGroup.includes(current.id);
				onSelect((current) =>
					change.type === "select" && change.selected
						? isIn(current)
							? current
							: { kind: "edge", id: change.id }
						: isIn(current)
							? null
							: current,
				);
			}
		},
		[groupOf, selection, onFlowChange, onSelect],
	);

	/** An edge dropped on a box leads to the node the Section starts at. */
	const targetOf = useCallback(
		(target: string): string | null => {
			const sectionId = sectionIdOf(target);
			if (sectionId === undefined) return target;
			const section = flow.sections?.find((s) => s.id === sectionId);
			return section
				? sectionBoundary(flow, nodesWithin(flow, section)).entry
				: null;
		},
		[flow],
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			const target = targetOf(connection.target);
			if (!connection.sourceHandle || !target) return;
			const result = addEdge(
				flow,
				connection.source,
				connection.sourceHandle as Outcome,
				target,
			);
			if (!result) return;
			onFlowChange(() => result.flow);
			onSelect({ kind: "edge", id: result.id });
		},
		[flow, targetOf, onFlowChange, onSelect],
	);

	const isValidConnection = useCallback<IsValidConnection<FlowCanvasEdge>>(
		(connection) => {
			const target = targetOf(connection.target);
			if (!target || sectionIdOf(connection.source) !== undefined) return false;
			return !flow.edges.some(
				(edge) =>
					edge.from === connection.source &&
					edge.outcome === connection.sourceHandle &&
					edge.to === target,
			);
		},
		[flow.edges, targetOf],
	);

	// Every node moves at once, so the toast offers the old places back. Fit
	// after React Flow has the new positions: a layout you cannot see looks
	// like nothing happened. The layout picks the direction that shows the
	// nodes biggest in the canvas the fit will show, less its padding.
	const store = useStoreApi<CanvasNode, FlowCanvasEdge>();
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
			onFlowChange((current) =>
				current.nodes.reduce((next, node) => {
					const position = at.get(node.id);
					return position ? moveNode(next, node.id, position) : next;
				}, current),
			);
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
					onFlowChange((current) =>
						current.nodes.reduce((next, node) => {
							const position = before.get(node.id);
							return position ? moveNode(next, node.id, position) : next;
						}, current),
					);
				},
			},
		});
	}, [flow, routes, routesKey, measured, onFlowChange, fitView, fit, store]);

	const selectEdge = useCallback(
		(id: string) => onSelect({ kind: "edge", id }),
		[onSelect],
	);
	const sectionActions = useMemo(
		() => ({ open: onOpenSection }),
		[onOpenSection],
	);
	const multi =
		!preview && selection?.kind === "nodes"
			? { nodes: selection.ids, sections: selection.sections ?? [] }
			: null;

	return (
		<div className="relative h-full min-h-0 overflow-hidden bg-muted/40 dark:bg-muted/20">
			<SelectEdgeContext.Provider value={preview ? null : selectEdge}>
				<SectionActionsContext.Provider value={sectionActions}>
					<OutcomeMarkers />
					<ReactFlow<CanvasNode, FlowCanvasEdge>
						nodes={nodes}
						edges={edges}
						nodeTypes={canvasNodeTypes}
						edgeTypes={edgeTypes}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onConnect={onConnect}
						isValidConnection={isValidConnection}
						onPaneClick={() => onSelect(null)}
						nodesDraggable={!preview}
						nodesConnectable={!preview}
						elementsSelectable={!preview}
						onNodeDoubleClick={(_, node) => {
							if (preview || isOutsideId(node.id)) return;
							const sectionId = sectionIdOf(node.id);
							if (sectionId === undefined) onNodeDoubleClick?.(node.id);
							else onOpenSection(sectionId);
						}}
						onSelectionStart={() => {
							boxSelecting.current = true;
						}}
						onSelectionEnd={() => {
							boxSelecting.current = false;
						}}
						onDragOver={(event) => {
							if (!event.dataTransfer.types.includes(NODE_DRAG_TYPE)) return;
							event.preventDefault();
							event.dataTransfer.dropEffect = "move";
						}}
						onDrop={(event) => {
							const type = event.dataTransfer.getData(NODE_DRAG_TYPE);
							if (preview || !isNodeType(type)) return;
							event.preventDefault();
							onDropNode(type, { x: event.clientX, y: event.clientY });
						}}
						deleteKeyCode={preview ? null : DELETE_KEYS}
						selectionKeyCode="Shift"
						multiSelectionKeyCode={["Meta", "Control"]}
						snapToGrid
						snapGrid={[8, 8]}
						fitView
						fitViewOptions={fit}
						minZoom={0.2}
						className="[--xy-background-color:transparent]"
						aria-label="Flow canvas"
					>
						<Background
							variant={BackgroundVariant.Dots}
							gap={16}
							size={1.25}
							color="color-mix(in oklch, var(--foreground) 16%, transparent)"
						/>
						<CanvasControls onAutoLayout={() => void autoLayout()} fit={fit} />
						<SectionZoom
							flow={flow}
							measured={measured}
							open={open.section?.id ?? null}
							onOpen={onOpenSection}
							onClose={() => onOpenSection(open.up)}
							fit={fit}
						/>
						{open.section && !preview ? (
							<OpenSectionBar
								path={open.path}
								flowLabel={flowLabel}
								onOpen={onOpenSection}
							/>
						) : null}
						{multi ? (
							<NodeToolbar
								nodeId={canvasIds(selection)}
								isVisible
								position={Position.Top}
							>
								<Button
									variant="outline"
									size="sm"
									className="bg-background shadow-sm dark:bg-background"
									onClick={() => onMakeSection(multi.nodes, multi.sections)}
								>
									<GroupIcon data-icon="inline-start" />
									Make section
									<KbdGroup>
										<Kbd>⌘/Ctrl</Kbd>
										<Kbd>G</Kbd>
									</KbdGroup>
								</Button>
							</NodeToolbar>
						) : null}
						{view.nodes.length > 4 ? (
							<MiniMap<CanvasNode>
								pannable
								zoomable
								ariaLabel="Mini map"
								className="m-3! hidden overflow-hidden rounded-lg border shadow-xs lg:block"
								style={{ width: 168, height: 112 }}
								nodeBorderRadius={6}
								nodeColor={MINI_MAP_COLOR}
							/>
						) : null}
					</ReactFlow>
				</SectionActionsContext.Provider>
			</SelectEdgeContext.Provider>
		</div>
	);
}
