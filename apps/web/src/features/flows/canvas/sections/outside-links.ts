// The edges of an open Section that cross its border. What lies outside
// does not show, so each outside end shows as one small node beside the
// Section's nodes: on the left what leads in, on the right where the edges
// go. It names the end as the level around draws it: a node, or the box of
// the Section that holds it.

import {
	type Flow,
	type FlowEdge,
	type OutcomeColor,
	outcomeColor,
	type SectionColor,
	sectionPath,
} from "@nightshift/flows";
import { type EdgeGroup, pairKey } from "../edge-groups";
import type { Point } from "../edge-route";
import type { EndOf } from "../route-cache";
import type { Rect } from "./section-geometry";
import { outsideNodeId, sectionNodeId } from "./section-ids";

/** One handle of an outside end that leads in: one node and outcome. */
export type OutsideExit = {
	from: string;
	outcome: string;
	color?: OutcomeColor;
};

export type OutsideEnd = {
	/** Its canvas id (`outsideNodeId`). */
	id: string;
	/** `in`: its edges lead into the open Section. `out`: they leave it. */
	side: "in" | "out";
	/** The node id, or the Section's label. */
	label: string;
	/** Set when the end is a Section's box. */
	section?: { id: string; color?: SectionColor };
	/** The level that shows this end: a Section id, or null for the whole flow. */
	level: string | null;
	/** `in` only: the node and outcome of each edge, one handle each. */
	exits: OutsideExit[];
	/** The canvas ids inside that its edges join. */
	inside: string[];
};

/**
 * How the level around the open Section draws a node outside it: the
 * node, or the box of the outermost Section that holds the node but not
 * the open Section.
 */
function outsideEnd(
	flow: Flow,
	around: readonly string[],
	nodeId: string,
): Pick<OutsideEnd, "label" | "section" | "level"> & { end: string } {
	const holder = flow.sections?.find((section) =>
		section.nodes.includes(nodeId),
	);
	let level: string | null = null;
	for (const section of holder ? sectionPath(flow, holder.id) : []) {
		if (around.includes(section.id)) {
			level = section.id;
			continue;
		}
		return {
			end: sectionNodeId(section.id),
			label: section.label.trim() || section.id,
			section: { id: section.id, color: section.color },
			level,
		};
	}
	return { end: nodeId, label: nodeId, level };
}

/**
 * The outside ends of the open Section `openId` and the drawn edges to
 * them. `inside` holds the ids of every node the open Section shows,
 * also those of the Sections inside it. `endOf` names what each inside
 * node is drawn as: itself, or the box of a Section inside.
 */
export function outsideLinks(
	flow: Flow,
	openId: string,
	inside: ReadonlySet<string>,
	endOf: EndOf,
): { ends: OutsideEnd[]; groups: EdgeGroup[] } {
	const around = sectionPath(flow, openId).map((section) => section.id);
	const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
	const ends = new Map<string, OutsideEnd>();
	const pairs = new Map<
		string,
		{ from: string; to: string; edges: FlowEdge[] }
	>();
	for (const edge of flow.edges) {
		if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
		const leaves = inside.has(edge.from);
		if (leaves === inside.has(edge.to)) continue;
		const side = leaves ? "out" : "in";
		const { end, ...shown } = outsideEnd(
			flow,
			around,
			leaves ? edge.to : edge.from,
		);
		const id = outsideNodeId(side, end);
		const near = endOf(leaves ? edge.from : edge.to);
		const known = ends.get(id);
		const outside = known ?? { id, side, ...shown, exits: [], inside: [] };
		if (!known) ends.set(id, outside);
		if (!outside.inside.includes(near)) outside.inside.push(near);
		if (
			!leaves &&
			!outside.exits.some(
				(exit) => exit.from === edge.from && exit.outcome === edge.outcome,
			)
		) {
			const source = nodes.get(edge.from);
			outside.exits.push({
				from: edge.from,
				outcome: edge.outcome,
				color: source ? outcomeColor(source, edge.outcome) : undefined,
			});
		}
		const from = leaves ? near : id;
		const to = leaves ? id : near;
		const key = pairKey(from, to);
		const pair = pairs.get(key);
		if (pair) pair.edges.push(edge);
		else pairs.set(key, { from, to, edges: [edge] });
	}
	const groups = [...pairs.entries()].map(([key, { from, to, edges }]) => ({
		id: (edges[0] as FlowEdge).id,
		key,
		from,
		to,
		edges,
	}));
	return { ends: [...ends.values()], groups };
}

/** Between the open Section's nodes and the outside ends. */
const OUTSIDE_GAP = 160;
/** Between two outside ends on one side. */
const STACK_GAP = 16;

/**
 * Where each outside end shows: left of `content` for the ends that lead
 * in, right of it for the others, each level with the middle of what it
 * joins inside, and never on top of another.
 */
export function placeOutside(
	ends: readonly OutsideEnd[],
	content: Rect,
	sizeOf: (id: string) => { width: number; height: number },
	middleOf: (id: string) => number | undefined,
): Map<string, Point> {
	const placed = new Map<string, Point>();
	for (const side of ["in", "out"] as const) {
		const wanted = ends
			.filter((end) => end.side === side)
			.map((end) => {
				const middles = end.inside.flatMap((id) => middleOf(id) ?? []);
				const middle =
					middles.length > 0
						? middles.reduce((sum, y) => sum + y, 0) / middles.length
						: content.y + content.height / 2;
				return { end, size: sizeOf(end.id), middle };
			})
			.sort((a, b) => a.middle - b.middle);
		let below = Number.NEGATIVE_INFINITY;
		for (const { end, size, middle } of wanted) {
			const y = Math.max(middle - size.height / 2, below);
			const x =
				side === "in"
					? content.x - OUTSIDE_GAP - size.width
					: content.x + content.width + OUTSIDE_GAP;
			placed.set(end.id, { x, y });
			below = y + size.height + STACK_GAP;
		}
	}
	return placed;
}
