// Why a selection cannot be a Section, in words the person can act on.
// `canMakeSection` in @nightshift/flows decides; this file only words it.

import type { Flow, SectionProblem } from "@nightshift/flows";

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
export function quotedList(ids: readonly string[]): string {
	const quoted = ids.map((id) => `"${id}"`);
	const last = quoted.pop();
	return quoted.length === 0
		? (last ?? "")
		: `${quoted.join(", ")} and ${last}`;
}

/** A Section's name in a sentence: its label, else its id. */
export function sectionName(section: { id: string; label: string }): string {
	const label = section.label.trim();
	return `"${label === "" ? section.id : label}"`;
}

/** One or two sentences for each problem, in the order they came. */
export function sectionProblemText(
	flow: Pick<Flow, "sections">,
	problem: SectionProblem,
): string {
	switch (problem.code) {
		case "empty":
			return "Select the nodes for the Section first.";
		case "unknown-nodes":
			return `This flow has no node ${quotedList(problem.nodes)}. Select nodes on the canvas.`;
		case "in-other-section": {
			const bySection = new Map<string, string[]>();
			for (const { node, section } of problem.nodes) {
				bySection.set(section, [...(bySection.get(section) ?? []), node]);
			}
			const sentences = [...bySection].map(([id, nodes]) => {
				const section = flow.sections?.find((s) => s.id === id);
				const name = section ? sectionName(section) : `"${id}"`;
				const verb = nodes.length === 1 ? "is" : "are";
				return `${quotedList(nodes)} ${verb} in the Section ${name} already.`;
			});
			return `${sentences.join(" ")} A node can be in one Section only.`;
		}
		case "unknown-sections":
			return `This flow has no Section ${quotedList(problem.sections)}. Select boxes on the canvas.`;
		case "section-in-other-section": {
			const sentences = problem.sections.map(({ section: id, holder }) => {
				const inner = flow.sections?.find((s) => s.id === id);
				const outer = flow.sections?.find((s) => s.id === holder);
				return `The Section ${inner ? sectionName(inner) : `"${id}"`} is in ${outer ? sectionName(outer) : `"${holder}"`} already.`;
			});
			return `${sentences.join(" ")} A Section can be in one Section only.`;
		}
		case "holds-itself":
			return "A Section cannot be inside itself.";
		case "not-together":
			return "Select nodes and boxes that are in the same Section, or all outside every Section.";
		case "not-connected":
			return "The selected nodes do not connect into one part. Add the nodes between them, or select fewer.";
		case "no-entry":
			return "No edge leads into the selected nodes. A Section needs one way in from the rest of the flow.";
		case "several-entries":
			return `The flow comes in at ${quotedList(problem.entries)}. A Section has one way in. Add the nodes before them, or select fewer.`;
	}
}
