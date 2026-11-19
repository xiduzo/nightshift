// The nodes the canvas shows: the flow's, the boxes of its Sections, and the issues of each.

import type { NodeSample } from "@nightshift/client";
import type { Flow, FlowCheck, FlowIssue } from "@nightshift/flows";
import { useMemo } from "react";
import type { DiffMark, FlowCanvasNode } from "../canvas";
import {
	type CanvasNode,
	type useMeasured,
	useOpenSection,
	useSectionCanvas,
} from "../canvas";
import type { TestMarksApi } from "../test-run";
import { viewerOf } from "./node-viewer";
import { type Selection, selectedNodeIds, selectedSectionIds } from "./session";

/** How the nodes and edges of a proposed flow differ from the draft, by id. */
export type CanvasPreview = {
	nodes: ReadonlyMap<string, DiffMark>;
	edges: ReadonlyMap<string, "added" | "removed">;
};

/** One empty list for every node without issues, so its data stays the same. */
const NO_ISSUES: FlowIssue[] = [];

/**
 * The nodes of the canvas, with their issues and their viewers: the open
 * Section's alone, and a box for each Section on view.
 */
export function useCanvasNodes({
	flow,
	check,
	selection,
	openSection,
	measured,
	preview,
	samples,
	test,
}: {
	flow: Flow;
	check: FlowCheck;
	selection: Selection;
	openSection: string | null;
	measured: ReturnType<typeof useMeasured>[0];
	preview: CanvasPreview | undefined;
	samples: ReadonlyMap<string, NodeSample> | null | undefined;
	test: TestMarksApi | undefined;
}) {
	const counts = useMemo(() => {
		const byNode = new Map<string, FlowIssue[]>();
		const bySection = new Map<string, FlowIssue[]>();
		const edgeErrors = new Set<string>();
		for (const issue of check.issues) {
			if (issue.nodeId) {
				const issues = byNode.get(issue.nodeId) ?? [];
				issues.push(issue);
				byNode.set(issue.nodeId, issues);
			}
			if (issue.sectionId) {
				const issues = bySection.get(issue.sectionId) ?? [];
				issues.push(issue);
				bySection.set(issue.sectionId, issues);
			}
			if (issue.edgeId && issue.severity === "error")
				edgeErrors.add(issue.edgeId);
		}
		return { byNode, bySection, edgeErrors };
	}, [check]);

	// An open Section shows its nodes alone. Edits still go to the whole flow.
	// The editor's session closes it when something outside is picked.
	const open = useOpenSection(flow, openSection);
	const view = open.view;

	const selectedSections = useMemo(
		() => selectedSectionIds(selection),
		[selection],
	);
	const sections = useSectionCanvas(view, {
		outside: open.section ? { flow, open: open.section.id } : undefined,
		measured,
		editable: !preview,
		issues: counts.bySection,
		selectedSections,
	});
	const { hidden } = sections;

	const marks = preview ? undefined : test?.marks;
	const pinned = preview ? undefined : test?.pinned;
	const nodes = useMemo<CanvasNode[]>(() => {
		const selected = new Set(selectedNodeIds(selection));
		const flowNodes = view.nodes.flatMap((node): FlowCanvasNode[] =>
			// A Section's nodes are not on the canvas at all, so no
			// click, box or key can select or delete them.
			hidden.has(node.id)
				? []
				: [
						{
							id: node.id,
							type: node.type,
							position: node.position,
							measured: measured[node.id],
							selected: !preview && selected.has(node.id),
							data: {
								node,
								isStart: view.start === node.id,
								issues: counts.byNode.get(node.id) ?? NO_ISSUES,
								change: preview?.nodes.get(node.id),
								...(preview ? {} : viewerOf(node, samples, marks, pinned)),
							},
						},
					],
		);
		return [...flowNodes, ...sections.boxes];
	}, [
		view.nodes,
		view.start,
		counts,
		measured,
		selection,
		hidden,
		sections.boxes,
		preview,
		samples,
		marks,
		pinned,
	]);
	return { counts, open, view, sections, nodes };
}
