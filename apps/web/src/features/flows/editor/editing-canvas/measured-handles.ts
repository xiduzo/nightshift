import type { InternalNode } from "@xyflow/react";
import {
	type CanvasNode,
	exitHandleId,
	type NodeHandles,
	type SectionBoxData,
	type Size,
	sectionIdOf,
} from "../../canvas";

/**
 * Where React Flow measured each node's handles, from the node's top-left
 * corner, and each box's size and handles, by Section id. Only the
 * height counts: inputs sit on the left side of a node and outcomes on its
 * right. A box names its exits as the layout does ("verdict · pass").
 */
export function measuredHandles(
	nodeLookup: ReadonlyMap<string, InternalNode<CanvasNode>>,
) {
	const handles: Record<string, NodeHandles> = {};
	const sectionHandles: Record<string, NodeHandles> = {};
	const sectionSizes: Record<string, Size> = {};
	for (const [id, node] of nodeLookup) {
		const bounds = node.internals.handleBounds;
		const { width, height } = node.measured;
		if (!bounds || width === undefined) continue;
		const labels =
			node.type === "sectionBox"
				? new Map(
						(node.data as SectionBoxData).exits.map((exit) => [
							exitHandleId(exit.from, exit.outcome),
							exit.label,
						]),
					)
				: undefined;
		const input = bounds.target?.[0];
		const measuredHandles: NodeHandles = {
			input: input ? { x: 0, y: input.y + input.height / 2 } : undefined,
			outcomes: Object.fromEntries(
				(bounds.source ?? []).flatMap((handle) => {
					const name =
						handle.id && (labels ? labels.get(handle.id) : handle.id);
					return name
						? [[name, { x: width, y: handle.y + handle.height / 2 }]]
						: [];
				}),
			),
		};
		const sectionId = sectionIdOf(id);
		if (sectionId === undefined) {
			handles[id] = measuredHandles;
			continue;
		}
		sectionHandles[sectionId] = measuredHandles;
		if (height !== undefined) sectionSizes[sectionId] = { width, height };
	}
	return { handles, sectionHandles, sectionSizes };
}
