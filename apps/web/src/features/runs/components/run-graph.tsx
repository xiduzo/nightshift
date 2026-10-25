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
	type CanvasNode,
	canvasEdges,
	canvasNodeTypes,
	edgeTypes,
	type FlowCanvasEdge,
	type FlowCanvasNode,
	type NodeRunState,
	OutcomeMarkers,
	readRoutes,
	SectionActionsContext,
	stepState,
	useFoldedSections,
	useMeasured,
	useSectionCanvas,
} from "@/features/flows";
import type { RunStatus, StepSummary } from "@/shared/api";

/**
 * The run's copy of its flow, read-only. Each node shows its latest step's
 * outcome and how often the run visited it; each edge how often it was taken.
 * Sections show as in the editor, folded as this browser keeps them: a
 * folded Section shows what its nodes do and which one runs now.
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
	foldKey,
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
	/** Names the flow (`<project>/<flow>`) for the Sections this browser keeps folded. */
	foldKey?: string;
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

	const { folded, setFolded } = useFoldedSections(foldKey);
	const run = useMemo(
		() => ({ states: runStates, order: steps.map((step) => step.nodeId) }),
		[runStates, steps],
	);
	const sections = useSectionCanvas(flow, {
		folded,
		measured,
		editable: false,
		selectedNode: selectedNodeId,
		run,
	});
	const sectionActions = useMemo(
		() => ({ setFolded, selectNode: onSelectNode }),
		[setFolded, onSelectNode],
	);

	const nodes = useMemo<CanvasNode[]>(
		() => [
			...sections.frames,
			...flow.nodes.flatMap((node): FlowCanvasNode[] =>
				sections.hidden.has(node.id)
					? []
					: [
							{
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
							},
						],
			),
			...sections.boxes,
		],
		[flow, measured, selectedNodeId, runStates, sections],
	);

	// The run's copy of the flow draws the routes of the flow's last layout,
	// as long as its nodes stand where that layout put them.
	const routes = useMemo(
		() => (routesKey ? readRoutes(routesKey) : {}),
		[routesKey],
	);
	const edges = useMemo<FlowCanvasEdge[]>(
		() =>
			canvasEdges(flow, sections.groups, {
				routes,
				traversals,
				boxes: sections.boxPositions,
				endOf: sections.endOf,
			}).map((edge) => ({ ...edge, selectable: false, focusable: false })),
		[flow, routes, traversals, sections],
	);

	return (
		<div className="relative size-full min-h-0">
			<SectionActionsContext.Provider value={sectionActions}>
				<OutcomeMarkers />
				<ReactFlow<CanvasNode, FlowCanvasEdge>
					nodes={nodes}
					edges={edges}
					nodeTypes={canvasNodeTypes}
					edgeTypes={edgeTypes}
					onNodesChange={applyDimensions}
					onNodeClick={(_, node) => {
						// A folded box shows the node in it that runs now.
						if (node.type === "sectionBox") {
							const now = node.data.run?.now;
							if (now) onSelectNode(now.nodeId);
						} else if (node.type !== "sectionFrame") onSelectNode(node.id);
					}}
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
			</SectionActionsContext.Provider>
		</div>
	);
}
