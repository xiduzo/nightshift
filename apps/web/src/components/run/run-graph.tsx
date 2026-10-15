import type { Flow } from "@nightshift/flows";
import {
	Background,
	BackgroundVariant,
	Controls,
	ReactFlow,
} from "@xyflow/react";
import { useMemo } from "react";

import {
	type FlowCanvasNode,
	type NodeRunState,
	nodeTypes,
} from "@/components/flow/flow-node";
import {
	edgeTypes,
	type FlowCanvasEdge,
	OutcomeMarkers,
} from "@/components/flow/outcome-edge";
import { useMeasured } from "@/components/flow/use-measured";
import { stepState } from "@/components/outcome-badge";
import type { StepSummary } from "@/lib/api-types";

/**
 * The run's copy of its flow, read-only. Each node shows its latest step's
 * outcome and how often the run visited it; each edge how often it was taken.
 */
export function RunGraph({
	flow,
	steps,
	traversals,
	selectedNodeId,
	onSelectNode,
}: {
	flow: Flow;
	/** In the order they started. */
	steps: StepSummary[];
	traversals: Record<string, number>;
	selectedNodeId: string | null;
	onSelectNode: (nodeId: string) => void;
}) {
	const [measured, applyDimensions] = useMeasured();

	const runStates = useMemo(() => {
		const states = new Map<string, NodeRunState>();
		for (const step of steps) {
			const visits = (states.get(step.nodeId)?.visits ?? 0) + 1;
			states.set(step.nodeId, { state: stepState(step), visits });
		}
		return states;
	}, [steps]);

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
					errorCount: 0,
					warningCount: 0,
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
					max: edge.max,
					hasError: false,
					traversals: traversals[edge.id] ?? 0,
				},
			})),
		[flow.edges, traversals],
	);

	return (
		<div className="relative h-full min-h-64">
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
				aria-label="Flow of this run"
			>
				<Background variant={BackgroundVariant.Dots} gap={16} size={1} />
				<Controls showInteractive={false} position="bottom-left" />
			</ReactFlow>
		</div>
	);
}
