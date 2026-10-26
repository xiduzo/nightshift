// The Sections of a flow as canvas nodes, shared by the editor, the run
// page and a Subflow seen in place: a box for each Section, the nodes the
// boxes hide, and the drawn edges with the boxes as their ends. A Section's
// nodes show when you open it (`section-focus.ts`), with what lies outside
// it at the ends of the edges that cross its border (`outside-links.ts`).

import {
	type Flow,
	type FlowIssue,
	outcomeColor,
	sectionBoundary,
} from "@nightshift/flows";
import { useMemo } from "react";
import { type EdgeGroup, groupEdges } from "../edge-groups";
import type { Point } from "../edge-route";
import type { NodeRunState } from "../flow-node";
import type { EndOf } from "../route-cache";
import type { Measured } from "../use-measured";
import { foldEdgeGroups, foldedMembers, sectionEnds } from "./folded-edges";
import { outsideLinks, placeOutside } from "./outside-links";
import { boxPosition, membersBounds, type Rect } from "./section-geometry";
import { sectionNodeId } from "./section-ids";
import type { OutsideNode, SectionBoxNode } from "./section-nodes";
import { type SectionRunSummary, sectionRunSummary } from "./section-run";

const NO_ISSUES: FlowIssue[] = [];
/** A box or an outside end React Flow has not measured yet. */
const FALLBACK_SIZE = { width: 256, height: 160 };

/** The ids of every Section of the flow: each shows as one box. */
export function sectionIds(flow: Pick<Flow, "sections">): ReadonlySet<string> {
	return new Set((flow.sections ?? []).map((section) => section.id));
}

export type SectionCanvas = {
	/** The drawn edges, with Sections as boxes, also those to the outside ends. */
	groups: readonly EdgeGroup[];
	/** The nodes the boxes hide. Leave them out of the canvas. */
	hidden: ReadonlySet<string>;
	/** The boxes, and what lies outside an open Section. */
	boxes: (SectionBoxNode | OutsideNode)[];
	/** Where each box and outside end is, by its canvas id, for edge routes. */
	boxPositions: ReadonlyMap<string, Point>;
	/** What each node is drawn as: itself, or its Section's box. */
	endOf: EndOf;
};

/** The Sections of `flow` as canvas nodes. */
export function useSectionCanvas(
	flow: Flow,
	{
		outside,
		measured,
		editable,
		issues,
		selectedSections,
		selectedNode,
		run,
	}: {
		/**
		 * `flow` is the open Section `open` of this flow (`sectionLevel`):
		 * its edges that cross the border then show too.
		 */
		outside?: { flow: Flow; open: string };
		measured: Measured;
		/** Boxes can be selected and dragged. */
		editable: boolean;
		/** Validation issues by Section id. */
		issues?: ReadonlyMap<string, FlowIssue[]>;
		/** The Sections whose boxes show selected. */
		selectedSections?: readonly string[];
		/** A box shows selected when it hides this node (run view). */
		selectedNode?: string | null;
		/** Run view: each node's latest step, and the node of every step in order. */
		run?: {
			states: ReadonlyMap<string, NodeRunState>;
			order: readonly string[];
		};
	},
): SectionCanvas {
	const folded = useMemo(() => sectionIds(flow), [flow]);
	const groups = useMemo(
		() => foldEdgeGroups(flow, groupEdges(flow), folded),
		[flow, folded],
	);
	const endOf = useMemo(() => sectionEnds(flow, folded), [flow, folded]);
	const whole = outside?.flow ?? flow;
	const openId = outside?.open;
	const crossing = useMemo(
		() =>
			openId === undefined
				? null
				: outsideLinks(
						whole,
						openId,
						new Set(flow.nodes.map((node) => node.id)),
						endOf,
					),
		[whole, openId, flow, endOf],
	);
	const allGroups = useMemo(
		() => (crossing ? [...groups, ...crossing.groups] : groups),
		[groups, crossing],
	);

	const layer = useMemo(() => {
		const sections = flow.sections ?? [];
		const known = new Set(flow.nodes.map((node) => node.id));
		const hidden = new Set(
			[...foldedMembers(flow, folded).keys()].filter((id) => known.has(id)),
		);
		const boxes: (SectionBoxNode | OutsideNode)[] = [];
		const boxPositions = new Map<string, Point>();
		// The run state of a Section's nodes, its latest step in its node's colour.
		const runOf = (
			members: readonly string[],
		): SectionRunSummary | undefined => {
			if (!run) return undefined;
			const summary = sectionRunSummary(members, run.states, run.order);
			const latest = summary.latest;
			const node =
				latest && flow.nodes.find((each) => each.id === latest.nodeId);
			if (!latest || !node) return summary;
			return {
				...summary,
				latest: { ...latest, color: outcomeColor(node, latest.state) },
			};
		};
		for (const section of sections) {
			const id = sectionNodeId(section.id);
			const count = section.nodes.filter((node) => known.has(node)).length;
			const sectionIssues = issues?.get(section.id) ?? NO_ISSUES;
			const selected = selectedSections?.includes(section.id) ?? false;
			const position = boxPosition(flow, section);
			if (!position) continue;
			boxPositions.set(id, position);
			// Edges that leave the open Section leave the box too.
			const boundary = sectionBoundary(whole, section.nodes);
			const nodeOf = (nodeId: string) =>
				whole.nodes.find((node) => node.id === nodeId);
			boxes.push({
				id,
				type: "sectionBox",
				position,
				measured: measured[id],
				selected:
					selected ||
					(selectedNode != null && section.nodes.includes(selectedNode)),
				draggable: editable,
				selectable: editable,
				focusable: editable,
				deletable: false,
				connectable: editable,
				data: {
					section,
					count,
					exits: boundary.outgoing.map(({ from, outcome, label }) => {
						const node = nodeOf(from);
						return {
							from,
							outcome,
							label,
							color: node ? outcomeColor(node, outcome) : undefined,
							taken: run ? run.states.get(from)?.state === outcome : undefined,
						};
					}),
					isStart: boundary.start,
					issues: sectionIssues,
					run: run ? runOf(section.nodes) : undefined,
				},
			});
		}
		if (crossing && crossing.ends.length > 0) {
			const sizeOf = (id: string) => measured[id] ?? FALLBACK_SIZE;
			const shown = flow.nodes
				.map((node) => node.id)
				.filter((id) => !hidden.has(id));
			const rects: Rect[] = [...boxPositions].map(([id, at]) => ({
				...at,
				...sizeOf(id),
			}));
			const nodesRect = membersBounds(flow, shown, measured);
			if (nodesRect) rects.push(nodesRect);
			const content = rects.reduce<Rect | null>(
				(all, rect) => (all ? union(all, rect) : rect),
				null,
			);
			const middleOf = (id: string) => {
				const at =
					boxPositions.get(id) ??
					flow.nodes.find((node) => node.id === id)?.position;
				return at ? at.y + sizeOf(id).height / 2 : undefined;
			};
			const placed = content
				? placeOutside(crossing.ends, content, sizeOf, middleOf)
				: new Map<string, Point>();
			for (const end of crossing.ends) {
				const position = placed.get(end.id);
				if (!position) continue;
				boxPositions.set(end.id, position);
				boxes.push({
					id: end.id,
					type: "outside",
					position,
					measured: measured[end.id],
					draggable: false,
					selectable: false,
					focusable: false,
					deletable: false,
					connectable: false,
					data: end,
				});
			}
		}
		return { hidden, boxes, boxPositions };
	}, [
		flow,
		whole,
		crossing,
		folded,
		measured,
		editable,
		issues,
		selectedSections,
		selectedNode,
		run,
	]);

	return { groups: allGroups, endOf, ...layer };
}

function union(a: Rect, b: Rect): Rect {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
}
