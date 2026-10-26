// The Sections of a flow as canvas nodes, shared by the editor, the run
// page and a Subflow seen in place: a box for each Section, the nodes the
// boxes hide, and the drawn edges with the boxes as their ends. A Section's
// nodes show when you open it (`section-focus.ts`).

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
import { boxPosition } from "./section-geometry";
import { sectionNodeId } from "./section-ids";
import type { SectionBoxNode } from "./section-nodes";
import { type SectionRunSummary, sectionRunSummary } from "./section-run";

const NO_ISSUES: FlowIssue[] = [];

/** The ids of every Section of the flow: each shows as one box. */
export function sectionIds(flow: Pick<Flow, "sections">): ReadonlySet<string> {
	return new Set((flow.sections ?? []).map((section) => section.id));
}

export type SectionCanvas = {
	/** The drawn edges, with Sections as boxes. */
	groups: readonly EdgeGroup[];
	/** The nodes the boxes hide. Leave them out of the canvas. */
	hidden: ReadonlySet<string>;
	boxes: SectionBoxNode[];
	/** Where each box is, by its canvas id, for edge routes. */
	boxPositions: ReadonlyMap<string, Point>;
	/** What each node is drawn as: itself, or its Section's box. */
	endOf: EndOf;
};

/** The Sections of `flow` as canvas nodes. */
export function useSectionCanvas(
	flow: Flow,
	{
		measured,
		editable,
		issues,
		selectedSections,
		selectedNode,
		run,
	}: {
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

	const layer = useMemo(() => {
		const sections = flow.sections ?? [];
		const known = new Set(flow.nodes.map((node) => node.id));
		const hidden = new Set(
			[...foldedMembers(flow, folded).keys()].filter((id) => known.has(id)),
		);
		const boxes: SectionBoxNode[] = [];
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
			const boundary = sectionBoundary(flow, section.nodes);
			const nodeOf = (nodeId: string) =>
				flow.nodes.find((node) => node.id === nodeId);
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
		return { hidden, boxes, boxPositions };
	}, [
		flow,
		folded,
		measured,
		editable,
		issues,
		selectedSections,
		selectedNode,
		run,
	]);

	return { groups, endOf, ...layer };
}
