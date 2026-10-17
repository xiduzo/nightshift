import type { Flow, Outcome } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { ButtonGroup } from "@nightshift/ui/components/button-group";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
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
import {
	ChevronDownIcon,
	MaximizeIcon,
	MinusIcon,
	PlusIcon,
	WorkflowIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { type FlowCanvasNode, nodeTypes } from "@/components/flow/flow-node";
import { PALETTE_ENTRY } from "@/components/flow/node-type";
import {
	edgeTypes,
	type FlowCanvasEdge,
	OutcomeMarkers,
	SelectEdgeContext,
} from "@/components/flow/outcome-edge";
import { useMeasured } from "@/components/flow/use-measured";
import {
	addEdge,
	addNode,
	type FlowCheck,
	moveNode,
	type NodeDefaults,
	type NodeKind,
	removeEdge,
	removeNode,
} from "@/lib/flow-draft";
import { layoutFlow } from "@/lib/flow-layout";

export type Selection =
	| { kind: "node"; id: string }
	| { kind: "edge"; id: string }
	| null;

type SelectionSetter = (
	selection: Selection | ((current: Selection) => Selection),
) => void;

const PALETTE: NodeKind[] = [
	"agent",
	"command",
	"decision",
	"gate",
	"subflow",
	"foreach",
	"value",
];

/** Below the node a new one lands on, so repeated adds do not stack exactly. */
const ADD_OFFSET = 32;

/**
 * Adds a node in the middle of the visible canvas, a third from the top,
 * nudged past nodes already on that spot, and selects it.
 */
function useAddNode(
	flow: Flow,
	onFlowChange: (change: (flow: Flow) => Flow) => void,
	onSelect: SelectionSetter,
	defaults: NodeDefaults | undefined,
) {
	const { screenToFlowPosition } = useReactFlow();
	const store = useStoreApi();
	return (type: NodeKind) => {
		const rect = store.getState().domNode?.getBoundingClientRect();
		const center = rect
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
 * The node types to add: a button group when the toolbar is wide enough,
 * an "Add node" menu when it is not. Lives in the toolbar above the canvas.
 */
export function NodePalette({
	flow,
	onFlowChange,
	onSelect,
	defaults,
}: {
	flow: Flow;
	onFlowChange: (change: (flow: Flow) => Flow) => void;
	onSelect: SelectionSetter;
	/** What a new Agent or Decision node starts with: the daemon's settings. */
	defaults?: NodeDefaults;
}) {
	const add = useAddNode(flow, onFlowChange, onSelect, defaults);
	return (
		<div className="min-w-0">
			<ButtonGroup aria-label="Add a node" className="@3xl:flex hidden">
				{PALETTE.map((type) => {
					const { label, icon: Icon, blurb } = PALETTE_ENTRY[type];
					return (
						<Tooltip key={type}>
							<TooltipTrigger
								render={
									<Button
										variant="outline"
										size="sm"
										onClick={() => add(type)}
										aria-label={`Add a ${label} node`}
									/>
								}
							>
								<Icon data-icon="inline-start" />
								{label}
							</TooltipTrigger>
							<TooltipContent side="bottom">{blurb}</TooltipContent>
						</Tooltip>
					);
				})}
			</ButtonGroup>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button variant="outline" size="sm" className="@3xl:hidden" />
					}
				>
					<PlusIcon data-icon="inline-start" />
					Add node
					<ChevronDownIcon data-icon="inline-end" />
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-72">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Add a node</DropdownMenuLabel>
						{PALETTE.map((type) => {
							const { label, icon: Icon, blurb } = PALETTE_ENTRY[type];
							return (
								<DropdownMenuItem
									key={type}
									className="items-start"
									onClick={() => add(type)}
								>
									<Icon className="mt-0.5" aria-hidden="true" />
									<span className="flex flex-col gap-0.5">
										<span className="font-medium">{label}</span>
										<span className="text-muted-foreground text-xs">
											{blurb}
										</span>
									</span>
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
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
}: {
	flow: Flow;
	check: FlowCheck;
	selection: Selection;
	onFlowChange: (change: (flow: Flow) => Flow) => void;
	onSelect: SelectionSetter;
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
		const byNode = new Map<string, { errors: number; warnings: number }>();
		const edgeErrors = new Set<string>();
		for (const issue of check.issues) {
			if (issue.nodeId) {
				const count = byNode.get(issue.nodeId) ?? { errors: 0, warnings: 0 };
				if (issue.severity === "error") count.errors += 1;
				else count.warnings += 1;
				byNode.set(issue.nodeId, count);
			}
			if (issue.edgeId && issue.severity === "error")
				edgeErrors.add(issue.edgeId);
		}
		return { byNode, edgeErrors };
	}, [check]);

	const nodes = useMemo<FlowCanvasNode[]>(
		() =>
			flow.nodes.map((node) => {
				const count = counts.byNode.get(node.id);
				return {
					id: node.id,
					type: node.type,
					position: node.position,
					measured: measured[node.id],
					selected: selection?.kind === "node" && selection.id === node.id,
					data: {
						node,
						isStart: flow.start === node.id,
						errorCount: count?.errors ?? 0,
						warningCount: count?.warnings ?? 0,
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
					max: edge.max,
					hasError: counts.edgeErrors.has(edge.id),
				},
			})),
		[flow.edges, counts, selection],
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
		<div className="relative h-full min-h-0 overflow-hidden rounded-xl border bg-muted/40 dark:bg-muted/20">
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
