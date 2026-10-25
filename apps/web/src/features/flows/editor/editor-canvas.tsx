import type { Flow, FlowIssue, FlowNodeType, Outcome } from "@nightshift/flows";
import {
	addEdge,
	addNode,
	type FlowCheck,
	moveNode,
	type NodeDefaults,
	removeEdge,
	removeNode,
	sectionBoundary,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { ButtonGroup } from "@nightshift/ui/components/button-group";
import { Kbd, KbdGroup } from "@nightshift/ui/components/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
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
	Panel,
	Position,
	ReactFlow,
	useNodesInitialized,
	useReactFlow,
	useStoreApi,
} from "@xyflow/react";
import {
	GroupIcon,
	MaximizeIcon,
	MinusIcon,
	PlusIcon,
	WorkflowIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { exitHandleId, groupEdges } from "../canvas/edge-groups";
import type { FlowCanvasNode } from "../canvas/flow-node";
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
import {
	moveSection,
	sectionDragDelta,
} from "../canvas/sections/section-geometry";
import { sectionIdOf } from "../canvas/sections/section-ids";
import {
	type CanvasNode,
	canvasNodeTypes,
	SectionActionsContext,
	type SectionBoxData,
} from "../canvas/sections/section-nodes";
import { useSectionCanvas } from "../canvas/sections/use-section-canvas";
import { useMeasured } from "../canvas/use-measured";
import { loadElk } from "./lib/elk";
import { layoutFlow, type NodeHandles, type Size } from "./lib/flow-layout";
import { isNodeType, NODE_DRAG_TYPE } from "./node-dock";
import {
	applyNodeSelection,
	type Selection,
	type SelectionSetter,
	selectedNodeIds,
	withoutNodes,
} from "./selection";

/** Below the node a new one lands on, so repeated adds do not stack exactly. */
const ADD_OFFSET = 32;

/** One empty list for every node without issues, so its data stays the same. */
const NO_ISSUES: FlowIssue[] = [];

/**
 * Adds a node and selects it: where it was dropped (`at`, a point on the
 * screen), or else in the middle of the visible canvas, a third from the
 * top. Nudged past nodes already on that spot.
 */
export function useAddNode(
	flow: Flow,
	onFlowChange: (change: (flow: Flow) => Flow) => void,
	onSelect: SelectionSetter,
	defaults: NodeDefaults | undefined,
) {
	const { screenToFlowPosition } = useReactFlow();
	const store = useStoreApi();
	return (type: FlowNodeType, at?: { x: number; y: number }) => {
		const rect = store.getState().domNode?.getBoundingClientRect();
		const center = at
			? screenToFlowPosition(at)
			: rect
				? screenToFlowPosition({
						x: rect.left + rect.width / 2,
						y: rect.top + rect.height / 3,
					})
				: { x: 0, y: 0 };
		// Nudge down past nodes that already sit on that spot.
		let position = { x: Math.round(center.x - 120), y: Math.round(center.y) };
		while (
			flow.nodes.some(
				(node) =>
					Math.abs(node.position.x - position.x) < ADD_OFFSET &&
					Math.abs(node.position.y - position.y) < ADD_OFFSET,
			)
		) {
			position = { x: position.x + ADD_OFFSET, y: position.y + ADD_OFFSET };
		}
		const result = addNode(flow, type, position, defaults);
		onFlowChange(() => result.flow);
		onSelect({ kind: "node", id: result.id });
	};
}

/**
 * Zoom in, zoom out, fit and auto layout, as a vertical shadcn button group.
 * Without `onAutoLayout`, as on a read-only canvas, there is no Lay out.
 */
export function CanvasControls({
	onAutoLayout,
}: {
	onAutoLayout?: () => void;
}) {
	const { zoomIn, zoomOut, fitView } = useReactFlow();
	const controls = [
		{
			label: "Zoom in",
			icon: PlusIcon,
			onClick: () => void zoomIn({ duration: 150 }),
		},
		{
			label: "Zoom out",
			icon: MinusIcon,
			onClick: () => void zoomOut({ duration: 150 }),
		},
		{
			label: "Fit view",
			icon: MaximizeIcon,
			onClick: () => void fitView({ duration: 200, maxZoom: 1, padding: 0.15 }),
		},
		...(onAutoLayout
			? [{ label: "Auto layout", icon: WorkflowIcon, onClick: onAutoLayout }]
			: []),
	];
	return (
		<Panel position="bottom-left" className="m-3!">
			<ButtonGroup orientation="vertical" aria-label="Canvas controls">
				{controls.map(({ label, icon: Icon, onClick }) => (
					<Tooltip key={label}>
						<TooltipTrigger
							render={
								<Button
									variant="outline"
									size="icon-sm"
									className="bg-background dark:bg-background"
									aria-label={label}
									onClick={onClick}
								/>
							}
						>
							<Icon />
						</TooltipTrigger>
						<TooltipContent side="right">{label}</TooltipContent>
					</Tooltip>
				))}
			</ButtonGroup>
		</Panel>
	);
}

/**
 * Where React Flow measured each node's handles, from the node's top-left
 * corner, and each folded box's size and handles, by Section id. Only the
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
		if (node.type === "sectionFrame") continue;
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

/** A Section's frame or box has no fill on the mini map, only its outline. */
function miniMapColor(node: CanvasNode): string {
	if (node.type === "sectionFrame") return "transparent";
	return "color-mix(in oklch, var(--muted-foreground) 45%, transparent)";
}

export function EditorCanvas({
	flow,
	routesKey,
	check,
	selection,
	folded,
	onFlowChange,
	onSelect,
	onSetFolded,
	onMakeSection,
	onDropNode,
	onNodeDoubleClick,
}: {
	flow: Flow;
	/** Names the flow for the routes this browser keeps of its last layout. */
	routesKey: string;
	check: FlowCheck;
	selection: Selection;
	/** The Sections this browser keeps folded. */
	folded: ReadonlySet<string>;
	onFlowChange: (change: (flow: Flow) => Flow) => void;
	onSelect: SelectionSetter;
	onSetFolded: (sectionId: string, folded: boolean) => void;
	/** "Make section" from the selected nodes. */
	onMakeSection: (nodeIds: string[]) => void;
	/** A node type dragged from the dock was dropped at this point of the screen. */
	onDropNode: (type: FlowNodeType, at: { x: number; y: number }) => void;
	/** A node was double-clicked, for example a Subflow to look inside. */
	onNodeDoubleClick?: (nodeId: string) => void;
}) {
	const [measured, applyDimensions] = useMeasured();
	const { fitView } = useReactFlow();

	// Fit once more when every node has its size: the first fit runs before
	// the nodes are measured and the panels have their final size.
	const initialized = useNodesInitialized();
	const fitted = useRef(false);
	useEffect(() => {
		if (!initialized || fitted.current) return;
		fitted.current = true;
		const frame = requestAnimationFrame(
			() => void fitView({ maxZoom: 1, padding: 0.15 }),
		);
		return () => cancelAnimationFrame(frame);
	}, [initialized, fitView]);

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

	const sections = useSectionCanvas(flow, {
		folded,
		measured,
		editable: true,
		issues: counts.bySection,
		selectedSection: selection?.kind === "section" ? selection.id : null,
	});
	const { hidden } = sections;

	const nodes = useMemo<CanvasNode[]>(() => {
		const selected = new Set(selectedNodeIds(selection));
		const flowNodes = flow.nodes.flatMap((node): FlowCanvasNode[] =>
			// A folded Section's nodes are not on the canvas at all, so no
			// click, box or key can select or delete them.
			hidden.has(node.id)
				? []
				: [
						{
							id: node.id,
							type: node.type,
							position: node.position,
							measured: measured[node.id],
							selected: selected.has(node.id),
							data: {
								node,
								isStart: flow.start === node.id,
								issues: counts.byNode.get(node.id) ?? NO_ISSUES,
							},
						},
					],
		);
		return [...sections.frames, ...flowNodes, ...sections.boxes];
	}, [
		flow.nodes,
		flow.start,
		counts,
		measured,
		selection,
		hidden,
		sections.frames,
		sections.boxes,
	]);

	// The routes of the last "Lay out". Each holds while its nodes stay put.
	const [routes, setRoutes] = useState<RouteBook>(() => readRoutes(routesKey));
	const { groups, boxPositions } = sections;
	const edges = useMemo<FlowCanvasEdge[]>(
		() =>
			canvasEdges(flow, groups, {
				routes,
				errors: counts.edgeErrors,
				selected: selection?.kind === "edge" ? selection.id : undefined,
				boxes: boxPositions,
				endOf: sections.endOf,
			}).map((edge) =>
				// A line to a folded box stands for edges you cannot see:
				// Delete does not remove them. Select one on its label.
				sectionIdOf(edge.source) !== undefined ||
				sectionIdOf(edge.target) !== undefined
					? { ...edge, deletable: false }
					: edge,
			),
		[flow, groups, routes, counts, selection, boxPositions, sections.endOf],
	);
	// A drawn edge carries every edge of its node pair, under its first id.
	const groupOf = useMemo(
		() => new Map(groups.map((group) => [group.id, group])),
		[groups],
	);

	const onNodesChange = useCallback(
		(changes: NodeChange<CanvasNode>[]) => {
			applyDimensions(changes);
			const sectionMoves = new Map<string, { x: number; y: number }>();
			const moves: { id: string; position: { x: number; y: number } }[] = [];
			for (const change of changes) {
				if (change.type !== "position" || !change.position) continue;
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
			if (moves.length > 0 || sectionMoves.size > 0 || removed.length > 0) {
				onFlowChange((current) => {
					let next = current;
					// Dragging a frame or a box moves its nodes as one block,
					// from where they are now.
					const carried = new Set<string>();
					for (const [sectionId, to] of sectionMoves) {
						const section = next.sections?.find((s) => s.id === sectionId);
						if (!section) continue;
						const delta = sectionDragDelta(next, section, to, {
							sizes: measured,
							folded: folded.has(sectionId),
						});
						if (delta) next = moveSection(next, section, delta);
						for (const id of section.nodes) carried.add(id);
					}
					for (const { id, position } of moves) {
						if (!carried.has(id)) next = moveNode(next, id, position);
					}
					for (const id of removed) next = removeNode(next, id);
					return next;
				});
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
		[applyDimensions, onFlowChange, onSelect, measured, folded],
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

	/** An edge dropped on a folded box leads to the node the Section starts at. */
	const targetOf = useCallback(
		(target: string): string | null => {
			const sectionId = sectionIdOf(target);
			if (sectionId === undefined) return target;
			const section = flow.sections?.find((s) => s.id === sectionId);
			return section ? sectionBoundary(flow, section.nodes).entry : null;
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
			// A folded Section is one box: the layout moves its nodes as a
			// block, so the box (their top-left corner) lands where it laid it.
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
			const book = recordRoutes(
				laid.flow.nodes,
				groupEdges(laid.flow),
				laid.routes,
				sections.endOf,
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
		requestAnimationFrame(
			() => void fitView({ duration: 200, maxZoom: 1, padding: 0.15 }),
		);
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
	}, [
		flow,
		routes,
		routesKey,
		measured,
		folded,
		sections.endOf,
		onFlowChange,
		fitView,
		store,
	]);

	const selectEdge = useCallback(
		(id: string) => onSelect({ kind: "edge", id }),
		[onSelect],
	);
	const sectionActions = useMemo(
		() => ({ setFolded: onSetFolded }),
		[onSetFolded],
	);
	const multi = selection?.kind === "nodes" ? selection.ids : null;

	return (
		<div className="relative h-full min-h-0 overflow-hidden bg-muted/40 dark:bg-muted/20">
			<SelectEdgeContext.Provider value={selectEdge}>
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
						onNodeDoubleClick={(_, node) => {
							const sectionId = sectionIdOf(node.id);
							if (sectionId === undefined) onNodeDoubleClick?.(node.id);
							else if (node.type === "sectionBox")
								onSetFolded(sectionId, false);
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
							if (!isNodeType(type)) return;
							event.preventDefault();
							onDropNode(type, { x: event.clientX, y: event.clientY });
						}}
						deleteKeyCode={["Backspace", "Delete"]}
						selectionKeyCode="Shift"
						multiSelectionKeyCode={["Meta", "Control"]}
						snapToGrid
						snapGrid={[8, 8]}
						fitView
						fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
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
						<CanvasControls onAutoLayout={() => void autoLayout()} />
						{multi ? (
							<NodeToolbar nodeId={multi} isVisible position={Position.Top}>
								<Button
									variant="outline"
									size="sm"
									className="bg-background shadow-sm dark:bg-background"
									onClick={() => onMakeSection(multi)}
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
						{flow.nodes.length > 4 ? (
							<MiniMap<CanvasNode>
								pannable
								zoomable
								ariaLabel="Mini map"
								className="m-3! hidden overflow-hidden rounded-lg border shadow-xs lg:block"
								style={{ width: 168, height: 112 }}
								nodeBorderRadius={6}
								nodeColor={miniMapColor}
								nodeStrokeColor={(node) =>
									node.type === "sectionFrame"
										? "color-mix(in oklch, var(--muted-foreground) 45%, transparent)"
										: "transparent"
								}
							/>
						) : null}
					</ReactFlow>
				</SectionActionsContext.Provider>
			</SelectEdgeContext.Provider>
		</div>
	);
}
