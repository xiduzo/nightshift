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
	edgeColor,
	edgeTypes,
	type FlowCanvasEdge,
	type FlowCanvasNode,
	type NodeRunState,
	nodeTypes,
	OutcomeMarkers,
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

	const edges = useMemo<FlowCanvasEdge[]>(
		() =>
			flow.edges.map((edge) => ({
				id: edge.id,
				type: "outcome",
				source: edge.from,
				sourceHandle: edge.outcome,
				target: edge.to,
				selectable: false,
				focusable: false,
				data: {
					outcome: edge.outcome,
					color: edgeColor(flow.nodes, edge),
					max: edge.max,
					hasError: false,
					traversals: traversals[edge.id] ?? 0,
				},
			})),
		[flow.edges, flow.nodes, traversals],
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
