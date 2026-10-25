import {
	addSection,
	type Flow,
	type FlowSection,
	removeSection,
} from "@nightshift/flows";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { type Selection, selectedNodeIds, withoutNodes } from "../selection";
import { sectionName, sectionProblemText } from "./section-problems";

/**
 * The edits of Sections that reach past one field: make one from the
 * selected nodes, remove one (with an undo), and fold one without leaving
 * hidden nodes selected.
 */
export function sectionEdits(
	draft: Flow,
	setDraft: Dispatch<SetStateAction<Flow>>,
	setSelection: Dispatch<SetStateAction<Selection>>,
	setFolded: (sectionId: string, folded: boolean) => void,
) {
	/** Returns the new Section's id, or null when the nodes cannot form one. */
	const makeSection = (nodeIds: readonly string[]): string | null => {
		const result = addSection(draft, nodeIds);
		if (!result.ok) {
			toast.error("Could not make a section", {
				description: result.problems
					.map((problem) => sectionProblemText(draft, problem))
					.join(" "),
			});
			return null;
		}
		setDraft(result.flow);
		setSelection({ kind: "section", id: result.id });
		return result.id;
	};

	const removeWithUndo = (sectionId: string) => {
		const sections = draft.sections ?? [];
		const index = sections.findIndex((section) => section.id === sectionId);
		const section = sections[index];
		if (!section) return;
		setDraft((current) => removeSection(current, sectionId));
		setFolded(sectionId, false);
		setSelection(null);
		toast.info(`Removed the Section ${sectionName(section)}. Its nodes stay.`, {
			action: {
				label: "Undo",
				onClick: () =>
					setDraft((current) => restoreSection(current, section, index)),
			},
		});
	};

	/** Folding hides its nodes: a selection of them moves to the Section. */
	const setSectionFolded = (sectionId: string, folded: boolean) => {
		setFolded(sectionId, folded);
		if (!folded) return;
		const section = draft.sections?.find((s) => s.id === sectionId);
		if (!section) return;
		const members = new Set(section.nodes);
		setSelection((current) => {
			if (!selectedNodeIds(current).some((id) => members.has(id)))
				return current;
			return (
				withoutNodes(current, members) ?? { kind: "section", id: sectionId }
			);
		});
	};

	return { makeSection, removeWithUndo, setSectionFolded };
}

/**
 * Puts a removed Section back where it was, with the nodes it held that are
 * still in the flow and in no other Section.
 */
export function restoreSection(
	flow: Flow,
	section: FlowSection,
	index: number,
): Flow {
	const sections = flow.sections ?? [];
	if (sections.some((other) => other.id === section.id)) return flow;
	const known = new Set(flow.nodes.map((node) => node.id));
	const taken = new Set(sections.flatMap((other) => other.nodes));
	const nodes = section.nodes.filter((id) => known.has(id) && !taken.has(id));
	if (nodes.length === 0) return flow;
	const at = Math.min(index, sections.length);
	return {
		...flow,
		sections: [
			...sections.slice(0, at),
			{ ...section, nodes },
			...sections.slice(at),
		],
	};
}
