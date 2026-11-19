import type { NodeSample } from "@nightshift/client";
import type { Flow, FlowCheck } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Kbd, KbdGroup } from "@nightshift/ui/components/kbd";
import {
	Background,
	BackgroundVariant,
	type EdgeTypes,
	MiniMap,
	NodeToolbar,
	Position,
	ReactFlow,
	useNodesInitialized,
	useReactFlow,
	useStore,
} from "@xyflow/react";
import { GroupIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	CanvasControls,
	type CanvasNode,
	canvasNodeTypes,
	DataEdge,
	DataMarker,
	edgeTypes,
	fitViewOptions,
	isOutsideId,
	OpenSectionBar,
	OutcomeMarkers,
	type RouteBook,
	readRoutes,
	SectionActionsContext,
	SectionZoom,
	SelectEdgeContext,
	sectionIdOf,
	useMeasured,
} from "../canvas";
import type { TestMarksApi } from "../test-run";
import { NodeMenu } from "../test-run";
import { NODE_DRAG_TYPE } from "./add-node";
import { useAutoLayout } from "./auto-layout";
import { useConnect, useEdgeChanges, useNodeChanges } from "./canvas-changes";
import { type CanvasEdge, useCanvasEdges } from "./canvas-edges";
import { type CanvasPreview, useCanvasNodes } from "./canvas-nodes";
import { canvasIds, type Selection, type SelectionSetter } from "./session";

/** The keys that delete what is selected. */
const DELETE_KEYS = ["Backspace", "Delete"];

const EDGE_TYPES: EdgeTypes = { ...edgeTypes, data: DataEdge };

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
	onPaneDoubleClick,
	openSection,
	onOpenSection,
	flowLabel,
	preview,
	coveredRight = 0,
	samples,
	test,
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
	/** A node, kit or preset dragged from the dock or the grid was dropped at this point of the screen, by its catalog key. */
	onDropNode: (key: string, at: { x: number; y: number }) => void;
	/** A node was double-clicked, for example a Subflow to look inside. */
	onNodeDoubleClick?: (nodeId: string) => void;
	/** The empty canvas was double-clicked at this point of the screen: add a node there. */
	onPaneDoubleClick?: (at: { x: number; y: number }) => void;
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
	/**
	 * What each node gave in the flow's newest runs (`useNodeSamples`): each
	 * node shows it in its viewer. Null or absent: no viewers. A proposal
	 * shows none.
	 */
	samples?: ReadonlyMap<string, NodeSample> | null;
	/**
	 * The pins and skips of a test run: the cards show them, and a node's
	 * menu changes them. A proposal and a revision show none.
	 */
	test?: TestMarksApi;
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

	const { counts, open, view, sections, nodes } = useCanvasNodes({
		flow,
		check,
		selection,
		openSection,
		measured,
		preview,
		samples,
		test,
	});

	// The routes of the last "Lay out". Each holds while its nodes stay put.
	const [routes, setRoutes] = useState<RouteBook>(() => readRoutes(routesKey));
	const { allEdges, groupOf } = useCanvasEdges({
		flow,
		sections,
		routes,
		counts,
		selection,
		preview,
		view,
	});

	const { onNodesChange } = useNodeChanges({
		applyDimensions,
		onFlowChange,
		onSelect,
	});
	const { boxSelecting, onEdgesChange } = useEdgeChanges({
		groupOf,
		selection,
		onFlowChange,
		onSelect,
	});
	const { onConnect, isValidConnection } = useConnect({
		flow,
		onFlowChange,
		onSelect,
	});
	const { autoLayout } = useAutoLayout({
		flow,
		routes,
		setRoutes,
		routesKey,
		measured,
		onFlowChange,
		fitView,
		fit,
	});

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

	const canvas = (
		<div className="relative h-full min-h-0 overflow-hidden bg-muted/40 dark:bg-muted/20">
			<SelectEdgeContext.Provider value={preview ? null : selectEdge}>
				<SectionActionsContext.Provider value={sectionActions}>
					<OutcomeMarkers />
					<DataMarker />
					<ReactFlow<CanvasNode, CanvasEdge>
						nodes={nodes}
						edges={allEdges}
						nodeTypes={canvasNodeTypes}
						edgeTypes={EDGE_TYPES}
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
						// A double-click on the empty canvas adds a node there. It
						// does not zoom. A Section box still opens on one.
						zoomOnDoubleClick={false}
						onDoubleClick={(event) => {
							if (preview) return;
							const target = event.target;
							if (
								target instanceof Element &&
								target.classList.contains("react-flow__pane")
							)
								onPaneDoubleClick?.({ x: event.clientX, y: event.clientY });
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
							const key = event.dataTransfer.getData(NODE_DRAG_TYPE);
							if (preview || !key) return;
							event.preventDefault();
							onDropNode(key, { x: event.clientX, y: event.clientY });
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
	// The node menu: not on a proposal or a revision.
	return test && !preview ? (
		<NodeMenu flow={flow} samples={samples} test={test}>
			{canvas}
		</NodeMenu>
	) : (
		canvas
	);
}
