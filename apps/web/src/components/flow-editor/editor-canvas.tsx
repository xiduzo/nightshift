import type { Flow, FlowNodeType, Outcome } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Background,
	BackgroundVariant,
	type Connection,
	Controls,
	type EdgeChange,
	type IsValidConnection,
	type NodeChange,
	Panel,
	ReactFlow,
	useReactFlow,
} from "@xyflow/react";
import { useCallback, useMemo, useRef } from "react";

import { type FlowCanvasNode, nodeTypes } from "@/components/flow/flow-node";
import { NODE_TYPE } from "@/components/flow/node-type";
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
	removeEdge,
	removeNode,
} from "@/lib/flow-draft";

export type Selection =
	| { kind: "node"; id: string }
	| { kind: "edge"; id: string }
	| null;

const PALETTE: FlowNodeType[] = [
	"agent",
	"command",
	"decision",
	"gate",
	"foreach",
];

/** Below the node a new one lands on, so repeated adds do not stack exactly. */
const ADD_OFFSET = 32;

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
	onSelect: (
		selection: Selection | ((current: Selection) => Selection),
	) => void;
}) {
	const wrapper = useRef<HTMLDivElement>(null);
	const { screenToFlowPosition } = useReactFlow();
	const [measured, applyDimensions] = useMeasured();

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

	const add = (type: FlowNodeType) => {
		const rect = wrapper.current?.getBoundingClientRect();
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
		const result = addNode(flow, type, position);
		onFlowChange(() => result.flow);
		onSelect({ kind: "node", id: result.id });
	};

	const selectEdge = useCallback(
		(id: string) => onSelect({ kind: "edge", id }),
		[onSelect],
	);

	return (
		<div ref={wrapper} className="relative h-full min-h-80">
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
					fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
					minZoom={0.2}
					aria-label="Flow canvas"
				>
					<Background variant={BackgroundVariant.Dots} gap={16} size={1} />
					<Controls showInteractive={false} position="bottom-left" />
					<Panel
						position="top-left"
						className="m-2 flex flex-wrap gap-1 border bg-card p-1"
						aria-label="Add a node"
					>
						{PALETTE.map((type) => {
							const { label, icon: Icon, blurb } = NODE_TYPE[type];
							return (
								<Button
									key={type}
									variant="ghost"
									size="sm"
									onClick={() => add(type)}
									title={`Add a ${label} node. ${blurb}`}
								>
									<Icon data-icon="inline-start" />
									{label}
								</Button>
							);
						})}
					</Panel>
				</ReactFlow>
			</SelectEdgeContext.Provider>
		</div>
	);
}
