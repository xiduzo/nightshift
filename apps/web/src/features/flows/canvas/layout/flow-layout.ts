// Arrange a flow and route its edges, the way you would draw it by hand.
//
// ELK Layered, because a flow is a layered graph with crossings to keep
// down, ports in a fixed order, labels that need room and loops to route
// around the nodes. That is not a few lines of our own code.
//
// Three steps, each its own function in its own file:
//
// 1. `flowGraph` (`layout-graph.ts`) turns the flow into a `LayoutGraph`:
//    nodes with their handles as ports, one edge per node pair, the model
//    order that tells ELK which edges loop back, and the flow's Sections as
//    groups. A folded Section is one node: its members go, and their edges
//    end on its box.
// 2. `elkGraph` (`elk-graph.ts`) turns a `LayoutGraph` into ELK's JSON for
//    one candidate (left to right, top to bottom, or wrapped into rows), and
//    `readLayout` (`read-layout.ts`) reads ELK's answer back into boxes and
//    routes.
// 3. `layoutBest` (`layout-best.ts`) lays out every candidate and keeps the
//    one whose nodes show biggest when fitted to the viewport.
//
// An open Section is a compound node with `hierarchyHandling:
// SEPARATE_CHILDREN`: ELK lays out its members first, always left to right,
// then the top level in the candidate's direction. In that mode an edge
// that crosses a frame gets no route, so `splitEdges` (`elk-graph.ts`) cuts
// it in up to three pieces: node to a port on the frame (inside), port to
// port (top level), port to node (inside the other Section). `readLayout` joins the
// pieces back into one route under the edge's own id. Loops keep their
// `back` hint on the top-level piece, or ELK may put a later Section first
// (research §5.1).

import {
	type Flow,
	moveNodes,
	sectionBoundary,
	sectionLevel,
} from "@nightshift/flows";
import type { EdgeRoute, Point } from "../edges";
import type { Direction, ElkLayout } from "./elk-graph";
import { layoutBest } from "./layout-best";
import type { Box, FlowGraphOptions, Size } from "./layout-graph";
import { flowGraph, layoutSections, sectionNodeId } from "./layout-graph";

/** The canvas snaps to this grid, so laid-out nodes land on it too. */
const GRID = 8;

/** Where a Section landed: its open frame, or its folded box. */
export type SectionBox = Box & { folded: boolean };

export type LayoutFlowOptions = FlowGraphOptions & {
	layout: ElkLayout;
	viewport?: Size;
};

/** The routes inside one open Section. */
export type LaidLevel = {
	/** What the Section shows open: its nodes, and its Sections as boxes. */
	flow: Flow;
	/** By pair key. */
	routes: Map<string, EdgeRoute>;
};

export type LaidFlow = {
	flow: Flow;
	/** By pair key. An edge between two nodes of one folded Section has none. */
	routes: Map<string, EdgeRoute>;
	/** The edges inside folded Sections, routed for when the Section
	 *  opens: one entry per Section, at any depth, with what that Section
	 *  shows open (`sectionLevel`), whose boxes are the ends. */
	inside: LaidLevel[];
	direction?: Direction;
	/** By Section id, on the canvas grid. Sections the layout left out (see
	 *  `layoutSections`) have none. */
	sections: Map<string, SectionBox>;
};

const snap = (value: number) => Math.round(value / GRID) * GRID;
const floorGrid = (value: number) => Math.floor(value / GRID) * GRID;
const ceilGrid = (value: number) => Math.ceil(value / GRID) * GRID;

/**
 * Lay out the flow and route its edges. Returns the flow with new
 * positions, on the canvas grid, a route per node pair, by pair key, and
 * a box per Section. The members of a folded Section move together, so
 * that the top-left of their bounds lands where the layout put the box.
 */
export async function layoutFlow(
	flow: Flow,
	{ layout, viewport, ...options }: LayoutFlowOptions,
): Promise<LaidFlow> {
	if (flow.nodes.length === 0) {
		return { flow, routes: new Map(), inside: [], sections: new Map() };
	}
	// Sections inside Sections: the top level shows the outer ones only.
	const level = sectionLevel(flow, null);
	const { boxes, routes, direction } = await layoutBest(
		layout,
		flowGraph(level, options),
		viewport,
	);

	const at = new Map<string, Point>();
	const inside: LaidLevel[] = [];
	const sections = new Map<string, SectionBox>();
	for (const section of layoutSections(level)) {
		const box = boxes.get(sectionNodeId(section.id));
		if (!box) continue;
		const folded = options.folded?.has(section.id) ?? false;
		if (folded) {
			// Its members get a layout of their own, left to right as in an
			// open frame, with its top-left corner on the box.
			const laid = await layoutInside(layout, flow, section.id, options);
			const shift = { x: snap(box.x), y: snap(box.y) };
			for (const [id, member] of laid.at) {
				at.set(id, { x: shift.x + member.x, y: shift.y + member.y });
			}
			for (const each of laid.levels) inside.push(moveLevel(each, shift));
			sections.set(section.id, {
				x: snap(box.x),
				y: snap(box.y),
				width: box.width,
				height: box.height,
				folded,
			});
			continue;
		}
		// Outward to the grid, so a member snapped by half a step stays inside.
		const x = floorGrid(box.x);
		const y = floorGrid(box.y);
		sections.set(section.id, {
			x,
			y,
			width: ceilGrid(box.x + box.width) - x,
			height: ceilGrid(box.y + box.height) - y,
			folded,
		});
	}
	for (const node of flow.nodes) {
		const box = boxes.get(node.id);
		if (box && !at.has(node.id))
			at.set(node.id, { x: snap(box.x), y: snap(box.y) });
	}

	return { flow: moveNodes(flow, at), routes, inside, direction, sections };
}

/**
 * What one Section holds, laid out left to right on its own, from 0, 0:
 * its nodes, and the Sections inside it as boxes, each laid out inside the
 * same way. The node the Section starts at comes first. Where each node
 * goes, on the grid, and the routes of each level.
 */
async function layoutInside(
	layout: ElkLayout,
	flow: Flow,
	sectionId: string,
	{ sizes, handles }: FlowGraphOptions,
): Promise<{ at: Map<string, Point>; levels: LaidLevel[] }> {
	const part = sectionLevel(flow, sectionId);
	const members = part.nodes.map((node) => node.id);
	const graph = flowGraph(
		{
			...part,
			start: sectionBoundary(flow, members).entry ?? members[0] ?? "",
		},
		{
			sizes,
			handles,
			folded: new Set((part.sections ?? []).map((inner) => inner.id)),
		},
	);
	const laid = await layoutBest(layout, graph);
	const at = new Map<string, Point>();
	const levels: LaidLevel[] = [{ flow: part, routes: laid.routes }];
	for (const inner of layoutSections(part)) {
		const box = laid.boxes.get(sectionNodeId(inner.id));
		if (!box) continue;
		const deeper = await layoutInside(layout, flow, inner.id, {
			sizes,
			handles,
		});
		const shift = { x: snap(box.x), y: snap(box.y) };
		for (const [id, member] of deeper.at) {
			at.set(id, { x: shift.x + member.x, y: shift.y + member.y });
		}
		for (const each of deeper.levels) levels.push(moveLevel(each, shift));
	}
	for (const id of members) {
		const box = laid.boxes.get(id);
		if (box && !at.has(id)) at.set(id, { x: snap(box.x), y: snap(box.y) });
	}
	return { at, levels };
}

function moveLevel(level: LaidLevel, by: Point): LaidLevel {
	return {
		flow: level.flow,
		routes: new Map(
			[...level.routes].map(([key, route]) => [key, moveRoute(route, by)]),
		),
	};
}

function moveRoute(route: EdgeRoute, by: Point): EdgeRoute {
	const move = (point: Point) => ({ x: point.x + by.x, y: point.y + by.y });
	return {
		points: route.points.map(move),
		label: route.label ? move(route.label) : undefined,
	};
}
