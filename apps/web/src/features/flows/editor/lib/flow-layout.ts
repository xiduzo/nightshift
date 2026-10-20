// Arrange a flow left to right, the way you would draw it by hand.
//
// Dagre, because a flow is a layered graph with crossings to keep down, and
// that is not a few lines of our own code. Pure: takes a flow and the sizes
// React Flow measured, returns the flow with new positions.

import dagre from "@dagrejs/dagre";
import { type Flow, nodeOutcomes } from "@nightshift/flows";

import { moveNode } from "../../flow-draft";

type Size = { width: number; height: number };
type Box = Size & { x: number; y: number };

/** A node React Flow has not measured yet: `w-64` and a typical body. Only
 *  affects spacing, never correctness. */
const FALLBACK_WIDTH = 256;
const FALLBACK_HEIGHT = 160;

/** Gaps between nodes. Roomy on purpose: edges carry outcome labels, and a
 *  label squeezed between two nodes is unreadable. */
const RANK_GAP = 128; // between columns, along the flow
const NODE_GAP = 64; // between nodes in one column

/** Between rows, when a long flow wraps: room for the edge that carries over
 *  to the next row, and its label. */
const ROW_GAP = 128;
/** An extra row must make the nodes this much bigger on screen to be worth
 *  it. A flow reads best in one row, so a near tie stays in one. */
const WRAP_GAIN = 1.1;

/** The canvas snaps to this grid, so laid-out nodes land on it too. */
const GRID = 8;

/**
 * A depth-first walk from the start node, each node's edges in the order its
 * handles show.
 *
 * Dagre breaks cycles itself, but by node insertion order: it may flip a
 * forward edge and keep the loop. The walk finds the edges that really go
 * back, and marks them `back`. It also yields `above` pairs: the nodes each
 * node reaches first, in handle order, so pass sits above fail. A node is
 * reached first from one node only, so the pairs never contradict each other.
 */
function walk(flow: Flow) {
	const ids = new Set(flow.nodes.map((node) => node.id));
	const outgoing = new Map<string, Flow["edges"]>();
	for (const node of flow.nodes) {
		const rank = nodeOutcomes(node);
		outgoing.set(
			node.id,
			flow.edges
				.filter((edge) => edge.from === node.id && ids.has(edge.to))
				.sort((a, b) => rank.indexOf(a.outcome) - rank.indexOf(b.outcome)),
		);
	}

	const nodes: string[] = [];
	const edges: { from: string; to: string; back: boolean }[] = [];
	const above: { left: string; right: string }[] = [];
	const onPath = new Set<string>();
	const visit = (id: string) => {
		nodes.push(id);
		onPath.add(id);
		let previous: string | undefined;
		for (const edge of outgoing.get(id) ?? []) {
			edges.push({ from: edge.from, to: edge.to, back: onPath.has(edge.to) });
			if (nodes.includes(edge.to)) continue;
			if (previous) above.push({ left: previous, right: edge.to });
			previous = edge.to;
			visit(edge.to);
		}
		onPath.delete(id);
	};
	// Start first; then whatever the start cannot reach, in file order.
	if (ids.has(flow.start)) visit(flow.start);
	for (const node of flow.nodes) if (!nodes.includes(node.id)) visit(node.id);
	return { nodes, edges, above };
}

/**
 * Cut the columns into rows, like lines of text, so a long flow fills the
 * viewport instead of shrinking to a strip. Rows stack top to bottom, each
 * still left to right: inputs are on the left of a node and outcomes on the
 * right, so a row that ran back would turn every edge around.
 *
 * A row ends only where one edge crosses, so a branch or a loop stays in one
 * row and one edge carries over. Of the ways to cut, the one whose nodes show
 * biggest when fitted wins.
 */
function wrap(
	boxes: Map<string, Box>,
	links: [string, string][],
	viewport: Size,
) {
	// Dagre centres the nodes of a column on one x.
	const byCentre = new Map<number, string[]>();
	for (const [id, box] of boxes) {
		const centre = Math.round(box.x + box.width / 2);
		byCentre.set(centre, [...(byCentre.get(centre) ?? []), id]);
	}
	const columns = [...byCentre.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, ids]) => {
			const laid = ids.map((id) => boxes.get(id) as Box);
			return {
				ids,
				left: Math.min(...laid.map((box) => box.x)),
				right: Math.max(...laid.map((box) => box.x + box.width)),
				top: Math.min(...laid.map((box) => box.y)),
				bottom: Math.max(...laid.map((box) => box.y + box.height)),
			};
		});
	const column = new Map(
		columns.flatMap(({ ids }, index) => ids.map((id) => [id, index] as const)),
	);
	// A cut after column `i` is clean when at most one edge crosses it.
	const clean = columns.map(
		(_, i) =>
			links.filter(([from, to]) => {
				const a = column.get(from) as number;
				const b = column.get(to) as number;
				return Math.min(a, b) <= i && i < Math.max(a, b);
			}).length <= 1,
	);

	const rowsWithin = (width: number) => {
		const rows: (typeof columns)[] = [[]];
		for (const [i, col] of columns.entries()) {
			const row = rows[rows.length - 1] as typeof columns;
			const first = row[0];
			if (first && col.right - first.left > width && clean[i - 1]) {
				rows.push([col]);
			} else row.push(col);
		}
		return rows.map((row) => ({
			columns: row,
			left: Math.min(...row.map((col) => col.left)),
			width:
				Math.max(...row.map((col) => col.right)) -
				Math.min(...row.map((col) => col.left)),
			top: Math.min(...row.map((col) => col.top)),
			height:
				Math.max(...row.map((col) => col.bottom)) -
				Math.min(...row.map((col) => col.top)),
		}));
	};
	// The zoom a fit would land on, capped where the canvas stops zooming in.
	const zoom = (rows: ReturnType<typeof rowsWithin>) => {
		const width = Math.max(...rows.map((row) => row.width));
		const height =
			rows.reduce((sum, row) => sum + row.height, 0) +
			ROW_GAP * (rows.length - 1);
		return Math.min(1, viewport.width / width, viewport.height / height);
	};

	const full = rowsWithin(Number.POSITIVE_INFINITY);
	let best = { rows: full, zoom: zoom(full) };
	for (let count = 2; count <= columns.length; count += 1) {
		const rows = rowsWithin((full[0]?.width ?? 0) / count);
		const fitted = zoom(rows);
		if (rows.length > best.rows.length && fitted > best.zoom * WRAP_GAIN) {
			best = { rows, zoom: fitted };
		}
	}

	let y = 0;
	for (const row of best.rows) {
		for (const col of row.columns) {
			for (const id of col.ids) {
				const box = boxes.get(id) as Box;
				box.x -= row.left;
				box.y += y - row.top;
			}
		}
		y += row.height + ROW_GAP;
	}
}

/**
 * Lay out the flow as columns of depth from the start node, left to right.
 * Loops run back to the left; nodes without edges still get a place. Given the
 * viewport to fit in, a long flow wraps into rows.
 */
export function layoutFlow(
	flow: Flow,
	{
		sizes = {},
		viewport,
	}: { sizes?: Record<string, Size>; viewport?: Size } = {},
): Flow {
	if (flow.nodes.length === 0) return flow;

	const graph = new dagre.graphlib.Graph();
	graph.setGraph({ rankdir: "LR", ranksep: RANK_GAP, nodesep: NODE_GAP });
	graph.setDefaultEdgeLabel(() => ({}));

	const { nodes, edges, above } = walk(flow);
	for (const id of nodes) {
		graph.setNode(id, {
			width: sizes[id]?.width ?? FALLBACK_WIDTH,
			height: sizes[id]?.height ?? FALLBACK_HEIGHT,
		});
	}
	for (const { from, to, back } of edges) {
		// A self-loop says nothing about where a node goes.
		if (from === to) continue;
		// Reversed, a loop's edge ranks its target before its source, as drawn.
		if (back) graph.setEdge(to, from);
		else graph.setEdge(from, to);
	}

	// Dagre's `left` is the top of a column when the flow runs left to right.
	dagre.layout(graph, { constraints: above });

	// Dagre centres each node; React Flow positions by the top-left corner.
	const boxes = new Map<string, Box>(
		nodes.map((id) => {
			const { x, y, width, height } = graph.node(id);
			return [id, { x: x - width / 2, y: y - height / 2, width, height }];
		}),
	);
	if (viewport) {
		const links = edges.flatMap(({ from, to }) =>
			from === to ? [] : [[from, to] as [string, string]],
		);
		wrap(boxes, links, viewport);
	}

	const snap = (value: number) => Math.round(value / GRID) * GRID;
	return flow.nodes.reduce((next, node) => {
		const box = boxes.get(node.id) as Box;
		return moveNode(next, node.id, { x: snap(box.x), y: snap(box.y) });
	}, flow);
}
