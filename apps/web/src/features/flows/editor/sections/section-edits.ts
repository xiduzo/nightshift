import {
	addSection,
	type Flow,
	type FlowSection,
	parentSection,
	removeSection,
} from "@nightshift/flows";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import type { Selection } from "../selection";
import type { SubflowMade } from "./make-subflow";
import { sectionName, sectionProblemText } from "./section-problems";

/**
 * The edits of Sections that reach past one field: make one from the
 * selected nodes, remove one (with an undo), and put a Subflow in its
 * place (with an undo).
 */
export function sectionEdits(
	draft: Flow,
	setDraft: Dispatch<SetStateAction<Flow>>,
	setSelection: Dispatch<SetStateAction<Selection>>,
) {
	/**
	 * A Section of the nodes and the Sections `sectionIds`. Returns its id,
	 * or null when they cannot form one.
	 */
	const makeSection = (
		nodeIds: readonly string[],
		sectionIds: readonly string[] = [],
	): string | null => {
		const result = addSection(draft, nodeIds, {}, sectionIds);
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
		const around = parentSection(draft, sectionId)?.id;
		setDraft((current) => removeSection(current, sectionId));
		setSelection(null);
		toast.info(`Removed the Section ${sectionName(section)}. Its nodes stay.`, {
			action: {
				label: "Undo",
				onClick: () =>
					setDraft((current) =>
						restoreSection(current, section, index, around),
					),
			},
		});
	};

	/**
	 * The new flow file of "Make subflow" is saved: the Subflow takes the
	 * Section's place in the draft and is selected. Undo puts the draft back
	 * while nothing else changed it. The new flow file stays.
	 */
	const applySubflow = (
		sectionId: string,
		made: SubflowMade,
		latest: () => Flow,
	) => {
		const before = draft;
		setDraft(made.caller);
		setSelection({ kind: "node", id: made.callNode });
		toast.success(
			`Made the Subflow "${made.name}". Save this flow to keep the change.`,
			{
				description: "Press i to look inside it.",
				action: {
					label: "Undo",
					onClick: () => {
						const back = undoSubflow(latest(), made, before);
						if (back === null) {
							toast.error(
								"Could not undo. You changed this flow after you made the Subflow.",
							);
							return;
						}
						setDraft(back);
						setSelection({ kind: "section", id: sectionId });
						toast.info(
							`The Section is back. The flow "${made.name}" stays in the project.`,
						);
					},
				},
			},
		);
	};

	return { makeSection, removeWithUndo, applySubflow };
}

/**
 * The draft before "Make subflow", while the draft is still the one the
 * action made. Null when something changed it since: undo would lose that.
 */
export function undoSubflow(
	current: Flow,
	made: Pick<SubflowMade, "caller">,
	before: Flow,
): Flow | null {
	return current === made.caller ? before : null;
}

/**
 * Puts a removed Section back where it was, inside the Section `around` if
 * it still exists. It takes back the nodes and Sections it held that are
 * still in the flow and in no other Section, or in `around`, where the
 * removal put them.
 */
export function restoreSection(
	flow: Flow,
	section: FlowSection,
	index: number,
	around?: string,
): Flow {
	const sections = flow.sections ?? [];
	if (sections.some((other) => other.id === section.id)) return flow;
	const parent = sections.find((other) => other.id === around);
	const known = new Set(flow.nodes.map((node) => node.id));
	const others = sections.filter((other) => other !== parent);
	const taken = new Set(others.flatMap((other) => other.nodes));
	const held = new Set(others.flatMap((other) => other.sections ?? []));
	const nodes = section.nodes.filter((id) => known.has(id) && !taken.has(id));
	const inner = (section.sections ?? []).filter(
		(id) => !held.has(id) && sections.some((other) => other.id === id),
	);
	if (nodes.length === 0 && inner.length === 0) return flow;
	const back: FlowSection = { ...section, nodes };
	if (section.sections) {
		if (inner.length > 0) back.sections = inner;
		else delete back.sections;
	}
	const mine = new Set([...nodes, ...inner]);
	const rest = sections.map((other) => {
		if (other !== parent) return other;
		const { sections: kids = [], ...fields } = other;
		const kept = [...kids.filter((id) => !mine.has(id)), section.id];
		return {
			...fields,
			nodes: other.nodes.filter((id) => !mine.has(id)),
			sections: kept,
		};
	});
	const at = Math.min(index, rest.length);
	return {
		...flow,
		sections: [...rest.slice(0, at), back, ...rest.slice(at)],
	};
}
