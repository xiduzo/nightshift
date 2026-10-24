import type { Flow, FlowIssue, FlowNodeType, Outcome } from "@nightshift/flows";
import {
	addEdge,
	addNode,
	type FlowCheck,
	moveNode,
	type NodeDefaults,
	removeEdge,
	removeNode,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { ButtonGroup } from "@nightshift/ui/components/button-group";
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
	type IsValidConnection,
	MiniMap,
	type NodeChange,
	Panel,
	ReactFlow,
	useNodesInitialized,
	useReactFlow,
	useStoreApi,
} from "@xyflow/react";
import { MaximizeIcon, MinusIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { type FlowCanvasNode, nodeTypes } from "../canvas/flow-node";
import {
	edgeColor,
	edgeTypes,
	type FlowCanvasEdge,
	OutcomeMarkers,
	SelectEdgeContext,
} from "../canvas/outcome-edge";
import { useMeasured } from "../canvas/use-measured";
import { layoutFlow } from "./lib/flow-layout";
import { isNodeType, NODE_DRAG_TYPE } from "./node-dock";

export type Selection =
	| { kind: "node"; id: string }
	| { kind: "edge"; id: string }
	| null;

type SelectionSetter = (
	selection: Selection | ((current: Selection) => Selection),
) => void;

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

/** Zoom in, zoom out, fit and auto layout, as a vertical shadcn button group. */
function CanvasControls({ onAutoLayout }: { onAutoLayout: () => void }) {
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
		{
			label: "Auto layout",
			icon: WorkflowIcon,
			onClick: onAutoLayout,
		},
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

export function EditorCanvas({
	flow,
	check,
	selection,
	onFlowChange,
	onSelect,
	onDropNode,
	onNodeDoubleClick,
}: {
	flow: Flow;
	check: FlowCheck;
	selection: Selection;
	onFlowChange: (change: (flow: Flow) => Flow) => void;
	onSelect: SelectionSetter;
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
		const edgeErrors = new Set<string>();
		for (const issue of check.issues) {
			if (issue.nodeId) {
				const issues = byNode.get(issue.nodeId) ?? [];
				issues.push(issue);
				byNode.set(issue.nodeId, issues);
			}
			if (issue.edgeId && issue.severity === "error")
				edgeErrors.add(issue.edgeId);
		}
		return { byNode, edgeErrors };
	}, [check]);

	const nodes = useMemo<FlowCanvasNode[]>(
		() =>
			flow.nodes.map((node) => {
				return {
					id: node.id,
					type: node.type,
					position: node.position,
					measured: measured[node.id],
					selected: selection?.kind === "node" && selection.id === node.id,
					data: {
						node,
						isStart: flow.start === node.id,
						issues: counts.byNode.get(node.id) ?? NO_ISSUES,
					},
				};
			}),
		[flow.nodes, flow.start, counts, measured, selection],
	);

	const edges = useMemo<FlowCanvasEdge[]>(
		() =>
			flow.edges.map((edge) => ({
				id: edge.id,
				type: "outcome",
				source: edge.from,
				sourceHandle: edge.outcome,
				target: edge.to,
				selected: selection?.kind === "edge" && selection.id === edge.id,
				data: {
					outcome: edge.outcome,
					color: edgeColor(flow.nodes, edge),
					max: edge.max,
					hasError: counts.edgeErrors.has(edge.id),
				},
			})),
		[flow.edges, flow.nodes, counts, selection],
	);

	const onNodesChange = useCallback(
		(changes: NodeChange<FlowCanvasNode>[]) => {
			applyDimensions(changes);
			const moves = changes.flatMap((change) =>
				change.type === "position" && change.position
					? [{ id: change.id, position: change.position }]
					: [],
			);
			const removed = changes.flatMap((change) =>
				change.type === "remove" ? [change.id] : [],
			);
			if (moves.length > 0 || removed.length > 0) {
				onFlowChange((current) => {
					let next = current;
					for (const { id, position } of moves)
						next = moveNode(next, id, position);
					for (const id of removed) next = removeNode(next, id);
					return next;
				});
			}
			for (const change of changes) {
				if (change.type === "select") {
					onSelect((current) =>
						change.selected
							? { kind: "node", id: change.id }
							: current?.kind === "node" && current.id === change.id
								? null
								: current,
					);
				} else if (change.type === "remove") {
					onSelect((current) =>
						current?.kind === "node" && current.id === change.id
							? null
							: current,
					);
				}
			}
		},
		[applyDimensions, onFlowChange, onSelect],
	);

	const onEdgesChange = useCallback(
		(changes: EdgeChange<FlowCanvasEdge>[]) => {
			const removed = changes.flatMap((change) =>
				change.type === "remove" ? [change.id] : [],
			);
			if (removed.length > 0) {
				onFlowChange((current) =>
					removed.reduce((next, id) => removeEdge(next, id), current),
				);
			}
			for (const change of changes) {
				if (change.type === "select") {
					onSelect((current) =>
						change.selected
							? { kind: "edge", id: change.id }
							: current?.kind === "edge" && current.id === change.id
								? null
								: current,
					);
				} else if (change.type === "remove") {
					onSelect((current) =>
						current?.kind === "edge" && current.id === change.id
							? null
							: current,
					);
				}
			}
		},
		[onFlowChange, onSelect],
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (!connection.sourceHandle) return;
			const result = addEdge(
				flow,
				connection.source,
				connection.sourceHandle as Outcome,
				connection.target,
			);
			if (!result) return;
			onFlowChange(() => result.flow);
			onSelect({ kind: "edge", id: result.id });
		},
		[flow, onFlowChange, onSelect],
	);

	const isValidConnection = useCallback<IsValidConnection<FlowCanvasEdge>>(
		(connection) =>
			!flow.edges.some(
				(edge) =>
					edge.from === connection.source &&
					edge.outcome === connection.sourceHandle &&
					edge.to === connection.target,
			),
		[flow.edges],
	);

	// Every node moves at once, so the toast offers the old places back. Fit
	// after React Flow has the new positions: a layout you cannot see looks
	// like nothing happened. The layout fills the canvas the fit will show,
	// less its padding, so a long flow wraps into rows.
	const store = useStoreApi<FlowCanvasNode, FlowCanvasEdge>();
	const autoLayout = useCallback(() => {
		const before = new Map(flow.nodes.map((node) => [node.id, node.position]));
		const { width, height } = store.getState();
		const viewport = { width: width / 1.15, height: height / 1.15 };
		onFlowChange((current) =>
			layoutFlow(current, { sizes: measured, viewport }),
		);
		requestAnimationFrame(
			() => void fitView({ duration: 200, maxZoom: 1, padding: 0.15 }),
		);
		toast.info("Laid out the flow.", {
			action: {
				label: "Undo",
				onClick: () =>
					onFlowChange((current) =>
						current.nodes.reduce((next, node) => {
							const position = before.get(node.id);
							return position ? moveNode(next, node.id, position) : next;
						}, current),
					),
			},
		});
	}, [flow.nodes, measured, onFlowChange, fitView, store]);

	const selectEdge = useCallback(
		(id: string) => onSelect({ kind: "edge", id }),
		[onSelect],
	);

	return (
		<div className="relative h-full min-h-0 overflow-hidden bg-muted/40 dark:bg-muted/20">
			<SelectEdgeContext.Provider value={selectEdge}>
				<OutcomeMarkers />
				<ReactFlow<FlowCanvasNode, FlowCanvasEdge>
					nodes={nodes}
					edges={edges}
					nodeTypes={nodeTypes}
					edgeTypes={edgeTypes}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={onConnect}
					isValidConnection={isValidConnection}
					onPaneClick={() => onSelect(null)}
					onNodeDoubleClick={(_, node) => onNodeDoubleClick?.(node.id)}
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
					selectionKeyCode={null}
					multiSelectionKeyCode={null}
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
					<CanvasControls onAutoLayout={autoLayout} />
					{flow.nodes.length > 4 ? (
						<MiniMap
							pannable
							zoomable
							ariaLabel="Mini map"
							className="m-3! hidden overflow-hidden rounded-lg border shadow-xs lg:block"
							style={{ width: 168, height: 112 }}
							nodeBorderRadius={6}
							nodeColor="color-mix(in oklch, var(--muted-foreground) 45%, transparent)"
						/>
					) : null}
				</ReactFlow>
			</SelectEdgeContext.Provider>
		</div>
	);
}
