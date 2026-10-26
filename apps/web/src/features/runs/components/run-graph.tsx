import type { Flow } from "@nightshift/flows";
import {
	Background,
	BackgroundVariant,
	Controls,
	Panel,
	ReactFlow,
} from "@xyflow/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	type CanvasNode,
	canvasEdges,
	canvasNodeTypes,
	edgeTypes,
	type FlowCanvasEdge,
	type FlowCanvasNode,
	type NodeRunState,
	OpenSectionBar,
	OutcomeMarkers,
	readRoutes,
	SectionActionsContext,
	SectionZoom,
	stepState,
	useMeasured,
	useOpenSection,
	useSectionCanvas,
} from "@/features/flows";
import type { RunStatus, StepSummary } from "@/shared/api";

const FIT = { maxZoom: 1, padding: 0.2 } as const;

/**
 * The run's copy of its flow, read-only. Each node shows its latest step's
 * outcome and how often the run visited it; each edge how often it was taken.
 * Sections show as boxes, as in the editor: each shows what its nodes do
 * and which one runs now. Zoom far into one, or double-click it, to see
 * only its nodes.
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
	flowLabel = "Flow",
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
	/** What the whole flow is called while a Section is open. */
	flowLabel?: string;
}) {
	const [measured, applyDimensions] = useMeasured();
	const [openId, setOpenId] = useState<string | null>(null);
	const open = useOpenSection(flow, openId);
	const view = open.view;

	// A step picked outside the open Section shows the whole flow again.
	const pickedBefore = useRef(selectedNodeId);
	useEffect(() => {
		if (pickedBefore.current === selectedNodeId) return;
		pickedBefore.current = selectedNodeId;
		if (
			selectedNodeId &&
			open.section &&
			!open.section.nodes.includes(selectedNodeId)
		)
			setOpenId(null);
	}, [selectedNodeId, open.section]);

	const runStates = useMemo(() => {
		const states = new Map<string, NodeRunState>();
		for (const step of steps) {
			const visits = (states.get(step.nodeId)?.visits ?? 0) + 1;
			states.set(step.nodeId, { state: stepState(step, runStatus), visits });
		}
		return states;
	}, [steps, runStatus]);

	const run = useMemo(
		() => ({ states: runStates, order: steps.map((step) => step.nodeId) }),
		[runStates, steps],
	);
	const sections = useSectionCanvas(view, {
		measured,
		editable: false,
		selectedNode: selectedNodeId,
		run,
	});
	const sectionActions = useMemo(
		() => ({ open: setOpenId, selectNode: onSelectNode }),
		[onSelectNode],
	);

	const nodes = useMemo<CanvasNode[]>(
		() => [
			...view.nodes.flatMap((node): FlowCanvasNode[] =>
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
									isStart: view.start === node.id,
									issues: [],
									run: runStates.get(node.id) ?? null,
								},
							},
						],
			),
			...sections.boxes,
		],
		[view, measured, selectedNodeId, runStates, sections],
	);

	// The run's copy of the flow draws the routes of the flow's last layout,
	// as long as its nodes stand where that layout put them.
	const routes = useMemo(
		() => (routesKey ? readRoutes(routesKey) : {}),
		[routesKey],
	);
	const edges = useMemo<FlowCanvasEdge[]>(
		() =>
			canvasEdges(view, sections.groups, {
				routes,
				traversals,
				boxes: sections.boxPositions,
				endOf: sections.endOf,
			}).map((edge) => ({ ...edge, selectable: false, focusable: false })),
		[view, routes, traversals, sections],
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
						// A box shows the node in it that runs now.
						if (node.type === "sectionBox") {
							const now = node.data.run?.now;
							if (now) onSelectNode(now.nodeId);
						} else onSelectNode(node.id);
					}}
					onNodeDoubleClick={(_, node) => {
						if (node.type === "sectionBox") setOpenId(node.data.section.id);
					}}
					zoomOnDoubleClick={false}
					nodesDraggable={false}
					nodesConnectable={false}
					edgesFocusable={false}
					deleteKeyCode={null}
					selectionKeyCode={null}
					multiSelectionKeyCode={null}
					fitView
					fitViewOptions={FIT}
					minZoom={0.2}
					aria-label={label}
				>
					{breadcrumb ? (
						<Panel position="top-left" className="m-2">
							{breadcrumb}
						</Panel>
					) : null}
					<SectionZoom
						flow={flow}
						measured={measured}
						open={open.section?.id ?? null}
						onOpen={setOpenId}
						onClose={() => setOpenId(null)}
						fit={FIT}
					/>
					{open.section ? (
						<OpenSectionBar
							section={open.section}
							flowLabel={flowLabel}
							onClose={() => setOpenId(null)}
						/>
					) : null}
					<Background variant={BackgroundVariant.Dots} gap={16} size={1} />
					<Controls showInteractive={false} position="bottom-left" />
				</ReactFlow>
			</SectionActionsContext.Provider>
		</div>
	);
}
