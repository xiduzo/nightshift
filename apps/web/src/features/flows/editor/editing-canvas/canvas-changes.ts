// What the canvas does with the changes React Flow reports: moves, removes, selects and new edges.

import type { Flow, Outcome } from "@nightshift/flows";
import {
	addEdge,
	moveNodes,
	nodesWithin,
	removeEdge,
	removeNode,
	sectionBoundary,
} from "@nightshift/flows";
import type {
	Connection,
	EdgeChange,
	IsValidConnection,
	NodeChange,
} from "@xyflow/react";
import { useCallback, useRef } from "react";
import {
	type CanvasNode,
	isDataEdgeId,
	moveSection,
	sectionDragDelta,
	sectionIdOf,
	type useMeasured,
} from "../../canvas";
import {
	applyNodeSelection,
	type Selection,
	type SelectionSetter,
	withoutNodes,
} from "../session";
import type { CanvasEdge, useCanvasEdges } from "./canvas-edges";

/**
 * Moves, removes and selects of nodes and Section boxes, as edits of the
 * flow and of the selection. A drag is one gesture for Undo.
 */
export function useNodeChanges({
	applyDimensions,
	onFlowChange,
	onSelect,
}: {
	applyDimensions: ReturnType<typeof useMeasured>[1];
	onFlowChange: (change: (flow: Flow) => Flow, gesture?: string) => void;
	onSelect: SelectionSetter;
}) {
	// Each drag is one gesture, from its first move to the drop.
	const drags = useRef({ count: 0, active: false });

	const onNodesChange = useCallback(
		(changes: NodeChange<CanvasNode>[]) => {
			applyDimensions(changes);
			const sectionMoves = new Map<string, { x: number; y: number }>();
			const moves: { id: string; position: { x: number; y: number } }[] = [];
			let dragging: boolean | undefined;
			for (const change of changes) {
				if (change.type !== "position") continue;
				dragging ||= change.dragging;
				if (!change.position) continue;
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
			// A drag is one gesture, and so are moves with the arrow keys.
			let gesture: string | undefined;
			if (dragging !== undefined && removed.length === 0) {
				if (dragging && !drags.current.active)
					drags.current = { count: drags.current.count + 1, active: true };
				gesture = drags.current.active
					? `drag:${drags.current.count}`
					: "nudge";
				if (!dragging) drags.current.active = false;
			}
			if (moves.length > 0 || sectionMoves.size > 0 || removed.length > 0) {
				onFlowChange((current) => {
					let next = current;
					// Dragging a box moves its nodes as one block, from where
					// they are now.
					const carried = new Set<string>();
					for (const [sectionId, to] of sectionMoves) {
						const found = next.sections?.find((s) => s.id === sectionId);
						if (!found) continue;
						// With the nodes of the Sections inside it.
						const section = { ...found, nodes: nodesWithin(next, found) };
						const delta = sectionDragDelta(next, section, to);
						if (delta) next = moveSection(next, section, delta);
						for (const id of section.nodes) carried.add(id);
					}
					if (moves.length > 0) {
						const positions = new Map<string, { x: number; y: number }>();
						for (const { id, position } of moves) {
							if (!carried.has(id)) positions.set(id, position);
						}
						next = moveNodes(next, positions);
					}
					for (const id of removed) next = removeNode(next, id);
					return next;
				}, gesture);
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
		[applyDimensions, onFlowChange, onSelect],
	);
	return { onNodesChange };
}

/**
 * Removes and selects of edges. A drawn line stands for every edge of its
 * node pair. While a box is drawn with Shift, edges are not selected.
 */
export function useEdgeChanges({
	groupOf,
	selection,
	onFlowChange,
	onSelect,
}: {
	groupOf: ReturnType<typeof useCanvasEdges>["groupOf"];
	selection: Selection;
	onFlowChange: (change: (flow: Flow) => Flow, gesture?: string) => void;
	onSelect: SelectionSetter;
}) {
	// A box drawn with Shift selects the nodes in it. React Flow selects
	// their edges too: the selection stays the nodes.
	const boxSelecting = useRef(false);

	const onEdgesChange = useCallback(
		(all: EdgeChange<CanvasEdge>[]) => {
			// A dotted line is no edge of the flow.
			const changes = all.filter(
				(change) => !("id" in change && isDataEdgeId(change.id)),
			);
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
	return { boxSelecting, onEdgesChange };
}

/** A new edge from an outcome, and which ends a new edge may join. */
export function useConnect({
	flow,
	onFlowChange,
	onSelect,
}: {
	flow: Flow;
	onFlowChange: (change: (flow: Flow) => Flow, gesture?: string) => void;
	onSelect: SelectionSetter;
}) {
	/** An edge dropped on a box leads to the node the Section starts at. */
	const targetOf = useCallback(
		(target: string): string | null => {
			const sectionId = sectionIdOf(target);
			if (sectionId === undefined) return target;
			const section = flow.sections?.find((s) => s.id === sectionId);
			return section
				? sectionBoundary(flow, nodesWithin(flow, section)).entry
				: null;
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

	const isValidConnection = useCallback<IsValidConnection<CanvasEdge>>(
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
	return { onConnect, isValidConnection };
}
