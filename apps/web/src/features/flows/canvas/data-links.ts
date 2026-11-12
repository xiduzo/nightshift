// The dotted lines of the one selected node: from each node it reads, and
// to each node that reads it (`dataLinks`). A node in a folded Section is
// drawn as its box, so its lines lead to the box.

import { type DataLink, dataLinks, type Flow } from "@nightshift/flows";
import { type ReactFlowState, useStore } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import type { DataCanvasEdge } from "./data-edge";
import type { EndOf } from "./route-cache";
import { sectionIdOf } from "./sections/section-ids";

const PREFIX = "data:";

/** Whether a canvas edge id names a dotted line, not an edge of the flow. */
export function isDataEdgeId(id: string): boolean {
	return id.startsWith(PREFIX);
}

/** One dotted line between two canvas nodes: a node, or a folded box. */
export type DataPair = { source: string; target: string; refs: string[] };

const pairKey = (pair: Pick<DataPair, "source" | "target">) =>
	`${pair.source} ${pair.target}`;

/**
 * The links into and out of the node `selected`, between what each end is
 * drawn as (`endOf`). Links between the same two ends become one line,
 * with the refs of all. A link inside one box does not show.
 */
export function selectedDataPairs(
	links: readonly DataLink[],
	selected: string,
	endOf: EndOf,
): DataPair[] {
	const pairs = new Map<string, DataPair>();
	for (const link of links) {
		if (link.from !== selected && link.to !== selected) continue;
		const source = endOf(link.from);
		const target = endOf(link.to);
		if (source === target) continue;
		const key = pairKey({ source, target });
		let pair = pairs.get(key);
		if (!pair) {
			pair = { source, target, refs: [] };
			pairs.set(key, pair);
		}
		for (const ref of link.refs) {
			if (!pair.refs.includes(ref)) pair.refs.push(ref);
		}
	}
	return [...pairs.values()];
}

/** Whether React Flow measured a handle of this kind on the canvas node. */
function hasHandle(
	state: ReactFlowState,
	id: string,
	type: "source" | "target",
): boolean {
	const bounds = state.nodeLookup.get(id)?.internals.handleBounds;
	return (bounds?.[type]?.length ?? 0) > 0;
}

const NO_EDGES: DataCanvasEdge[] = [];

/**
 * The dotted lines of the node `selected` in `flow` (the level the canvas
 * shows), as canvas edges. No node selected: no lines.
 */
export function useDataLinks(
	flow: Flow,
	selected: string | null,
	endOf: EndOf,
): DataCanvasEdge[] {
	const reading = selected !== null;
	const links = useMemo(
		() => (reading ? dataLinks(flow) : []),
		[flow, reading],
	);
	const pairs = useMemo(
		() => (selected === null ? [] : selectedDataPairs(links, selected, endOf)),
		[links, selected, endOf],
	);
	// React Flow draws an edge only from a source handle to a target
	// handle. A node with no outcome, such as an End, has none to leave
	// from: React Flow would refuse the line (error #008).
	const drawable = useStore(
		useCallback(
			(state: ReactFlowState) =>
				pairs
					.filter(
						(pair) =>
							hasHandle(state, pair.source, "source") &&
							hasHandle(state, pair.target, "target"),
					)
					.map(pairKey)
					.join("\n"),
			[pairs],
		),
	);
	return useMemo(() => {
		if (drawable === "") return NO_EDGES;
		const shown = new Set(drawable.split("\n"));
		const nameOf = (id: string) => {
			const sectionId = sectionIdOf(id);
			if (sectionId !== undefined)
				return (
					flow.sections?.find((section) => section.id === sectionId)?.label ||
					sectionId
				);
			return flow.nodes.find((node) => node.id === id)?.label ?? id;
		};
		return pairs.flatMap((pair): DataCanvasEdge[] =>
			shown.has(pairKey(pair))
				? [
						{
							id: `${PREFIX}${pair.source}>${pair.target}`,
							type: "data",
							source: pair.source,
							target: pair.target,
							data: { refs: pair.refs },
							selectable: false,
							deletable: false,
							focusable: false,
							reconnectable: false,
							interactionWidth: 0,
							ariaLabel: `${nameOf(pair.target)} reads ${nameOf(pair.source)}`,
						},
					]
				: [],
		);
	}, [pairs, drawable, flow]);
}
