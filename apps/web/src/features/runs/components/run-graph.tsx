import type { Flow } from "@nightshift/flows";
import {
	Background,
	BackgroundVariant,
	Controls,
	Panel,
	ReactFlow,
} from "@xyflow/react";
import { type ReactNode, useMemo } from "react";
import {
	canvasEdges,
	edgeTypes,
	type FlowCanvasEdge,
	type FlowCanvasNode,
	groupEdges,
	type NodeRunState,
	nodeTypes,
	OutcomeMarkers,
	readRoutes,
	stepState,
	useMeasured,
} from "@/features/flows";
import type { RunStatus, StepSummary } from "@/shared/api";

/**
 * The run's copy of its flow, read-only. Each node shows its latest step's
 * outcome and how often the run visited it; each edge how often it was taken.
 * The same view shows a called flow with one item's steps.
 */
export function RunGraph({
	flow,
	steps,
	runStatus,
	traversals,
	selectedNodeId,
	onSelectNode,
	breadcrumb,
	routesKey,
	label = "Flow of this run",
}: {
	flow: Flow;
	/** The steps of this flow only, in the order they started. */
	steps: StepSummary[];
	runStatus: RunStatus;
	traversals: Record<string, number>;
	selectedNodeId: string | null;
	onSelectNode: (nodeId: string) => void;
	/** Shown over the canvas, top left: where in the run this graph is. */
	breadcrumb?: ReactNode;
	/** Names the flow for the routes this browser keeps of its last layout. */
	routesKey?: string;
	label?: string;
}) {
	const [measured, applyDimensions] = useMeasured();

	const runStates = useMemo(() => {
		const states = new Map<string, NodeRunState>();
		for (const step of steps) {
			const visits = (states.get(step.nodeId)?.visits ?? 0) + 1;
			states.set(step.nodeId, { state: stepState(step, runStatus), visits });
		}
		return states;
	}, [steps, runStatus]);

	const nodes = useMemo<FlowCanvasNode[]>(
		() =>
			flow.nodes.map((node) => ({
				id: node.id,
				type: node.type,
				position: node.position,
				measured: measured[node.id],
				selected: node.id === selectedNodeId,
				draggable: false,
				connectable: false,
				data: {
					node,
					isStart: flow.start === node.id,
					issues: [],
					run: runStates.get(node.id) ?? null,
				},
			})),
		[flow, measured, selectedNodeId, runStates],
	);

	// The run's copy of the flow draws the routes of the flow's last layout,
	// as long as its nodes stand where that layout put them.
	const routes = useMemo(
		() => (routesKey ? readRoutes(routesKey) : {}),
		[routesKey],
	);
	const edges = useMemo<FlowCanvasEdge[]>(
		() =>
			canvasEdges(flow, groupEdges(flow), { routes, traversals }).map(
				(edge) => ({ ...edge, selectable: false, focusable: false }),
			),
		[flow, routes, traversals],
	);

	return (
		<div className="relative size-full min-h-0">
			<OutcomeMarkers />
			<ReactFlow<FlowCanvasNode, FlowCanvasEdge>
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				onNodesChange={applyDimensions}
				onNodeClick={(_, node) => onSelectNode(node.id)}
				nodesDraggable={false}
				nodesConnectable={false}
				edgesFocusable={false}
				deleteKeyCode={null}
				selectionKeyCode={null}
				multiSelectionKeyCode={null}
				fitView
				fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
				minZoom={0.2}
				aria-label={label}
			>
				{breadcrumb ? (
					<Panel position="top-left" className="m-2">
						{breadcrumb}
					</Panel>
				) : null}
				<Background variant={BackgroundVariant.Dots} gap={16} size={1} />
				<Controls showInteractive={false} position="bottom-left" />
			</ReactFlow>
		</div>
	);
}
