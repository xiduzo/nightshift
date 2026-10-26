// The Sections of a flow as canvas nodes, shared by the editor, the run
// page and a Subflow seen in place: a frame behind each unfolded Section,
// a box for each folded one, the nodes the boxes hide, and the drawn edges
// with the boxes as their ends.

import {
	type Flow,
	type FlowIssue,
	outcomeColor,
	sectionBoundary,
} from "@nightshift/flows";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type EdgeGroup, groupEdges } from "../edge-groups";
import type { Point } from "../edge-route";
import type { NodeRunState } from "../flow-node";
import type { EndOf } from "../route-cache";
import type { Measured } from "../use-measured";
import { foldsStorageKey, readFolds, withFold, writeFolds } from "./fold-state";
import { foldEdgeGroups, foldedMembers, sectionEnds } from "./folded-edges";
import { boxPosition, FRAME_PADDING, frameRect } from "./section-geometry";
import { sectionNodeId } from "./section-ids";
import type { SectionBoxNode, SectionFrameNode } from "./section-nodes";
import { type SectionRunSummary, sectionRunSummary } from "./section-run";

/**
 * Behind the edges, also when selected: React Flow lifts a selected node
 * by 1000, and edges draw at 0.
 */
const FRAME_Z = -1001;

const NO_ISSUES: FlowIssue[] = [];
const NO_FOLDS: ReadonlySet<string> = new Set();

/**
 * The Sections this browser keeps folded for a flow (`<project>/<flow>`),
 * and a way to fold or unfold one. Another tab that folds the same flow
 * folds it here too. No key: nothing is folded, and nothing is kept.
 */
export function useFoldedSections(flowKey: string | undefined) {
	const [state, setState] = useState(() => ({
		key: flowKey,
		folded: flowKey ? readFolds(flowKey) : NO_FOLDS,
	}));
	// Another flow: read its folds.
	const folded =
		state.key === flowKey
			? state.folded
			: flowKey
				? readFolds(flowKey)
				: NO_FOLDS;
	if (state.key !== flowKey) setState({ key: flowKey, folded });

	useEffect(() => {
		if (!flowKey) return;
		const onStorage = (event: StorageEvent) => {
			if (event.key !== foldsStorageKey(flowKey)) return;
			setState({ key: flowKey, folded: readFolds(flowKey) });
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [flowKey]);

	const setFolded = useCallback(
		(sectionId: string, fold: boolean) =>
			setState((current) => {
				const next = withFold(current.folded, sectionId, fold);
				if (next === current.folded) return current;
				if (current.key) writeFolds(current.key, next);
				return { ...current, folded: next };
			}),
		[],
	);
	return { folded, setFolded };
}

export type SectionCanvas = {
	/** The drawn edges, with folded Sections as boxes. */
	groups: readonly EdgeGroup[];
	/** The nodes folded boxes hide. Leave them out of the canvas. */
	hidden: ReadonlySet<string>;
	/** Put these first: they draw behind every node and edge. */
	frames: SectionFrameNode[];
	boxes: SectionBoxNode[];
	/** Where each box is, by its canvas id, for edge routes. */
	boxPositions: ReadonlyMap<string, Point>;
	/** What each node is drawn as: itself, or its folded Section's box. */
	endOf: EndOf;
};

/** The Sections of `flow` as canvas nodes. */
export function useSectionCanvas(
	flow: Flow,
	{
		folded,
		measured,
		editable,
		issues,
		selectedSection,
		selectedNode,
		run,
	}: {
		folded: ReadonlySet<string>;
		measured: Measured;
		/** Frames and boxes can be selected and dragged. */
		editable: boolean;
		/** Validation issues by Section id. */
		issues?: ReadonlyMap<string, FlowIssue[]>;
		selectedSection?: string | null;
		/** A box shows selected when it hides this node (run view). */
		selectedNode?: string | null;
		/** Run view: each node's latest step, and the node of every step in order. */
		run?: {
			states: ReadonlyMap<string, NodeRunState>;
			order: readonly string[];
		};
	},
): SectionCanvas {
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
		const frames: SectionFrameNode[] = [];
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
			const selected = selectedSection === section.id;
			if (!folded.has(section.id)) {
				const rect = frameRect(flow, section, measured);
				if (!rect) continue;
				frames.push({
					id,
					type: "sectionFrame",
					position: { x: rect.x, y: rect.y },
					width: rect.width,
					height: rect.height,
					measured: { width: rect.width, height: rect.height },
					zIndex: FRAME_Z,
					selected,
					draggable: editable,
					selectable: editable,
					focusable: editable,
					deletable: false,
					connectable: false,
					// Only the header takes the pointer (see `SectionFrame`).
					className: "pointer-events-none!",
					data: {
						section,
						count,
						issues: sectionIssues,
						header: FRAME_PADDING.top,
						run: run ? runOf(section.nodes) : undefined,
					},
				});
				continue;
			}
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
		return { hidden, frames, boxes, boxPositions };
	}, [
		flow,
		folded,
		measured,
		editable,
		issues,
		selectedSection,
		selectedNode,
		run,
	]);

	return { groups, endOf, ...layer };
}
