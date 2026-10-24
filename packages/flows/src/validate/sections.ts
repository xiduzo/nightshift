/** The checks of a flow's Sections. The engine does not read them, so every issue is a warning. */
import type { Flow, FlowSection } from "../document";
import { canMakeSection, type SectionProblem } from "../sections";
import type { Report } from "./issues";

/**
 * Unique ids, known nodes, a node in one Section only, and each Section
 * one connected part with one entry. A node that two Sections hold is
 * reported on the later Section.
 */
export function checkSections(flow: Flow, warning: Report): void {
	const sections = flow.sections ?? [];
	const firstIndex = new Map<string, number>();
	sections.forEach((section, index) => {
		if (firstIndex.has(section.id)) {
			warning(
				`Two Sections use the id "${section.id}". Give each Section its own id.`,
				{ sectionId: section.id },
			);
		} else {
			firstIndex.set(section.id, index);
		}
	});

	sections.forEach((section, index) => {
		const check = canMakeSection(flow, section.nodes, { section: section.id });
		if (check.ok) return;
		for (const problem of check.problems) {
			report(problem, section, sections, index, firstIndex, warning);
		}
	});
}

function report(
	problem: SectionProblem,
	section: FlowSection,
	sections: readonly FlowSection[],
	index: number,
	firstIndex: ReadonlyMap<string, number>,
	warning: Report,
): void {
	const name = nameOf(section);
	const at = { sectionId: section.id };
	switch (problem.code) {
		case "empty":
			warning(`${name} has no nodes. Add nodes to it, or remove it.`, at);
			return;
		case "unknown-nodes":
			for (const node of problem.nodes) {
				warning(
					`${name} holds "${node}", but this flow has no node "${node}". Remove it from the Section.`,
					at,
				);
			}
			return;
		case "in-other-section":
			for (const { node, section: otherId } of problem.nodes) {
				const otherIndex = firstIndex.get(otherId) ?? index;
				const other = sections[otherIndex];
				// The first Section that holds the node keeps it.
				if (otherIndex >= index || other === undefined) continue;
				warning(
					`Node "${node}" is in ${nameOf(other)} and in ${name}. Put each node in one Section only.`,
					{ ...at, nodeId: node },
				);
			}
			return;
		case "not-connected":
			warning(
				`The nodes in ${name} are not all connected. Connect them, or take nodes out of the Section.`,
				at,
			);
			return;
		case "no-entry":
			warning(
				`No edge leads into ${name}. Connect a node outside the Section to one of its nodes.`,
				at,
			);
			return;
		case "several-entries":
			warning(
				`The flow comes into ${name} at ${list(problem.entries)}. Send the edges from outside to one node only.`,
				at,
			);
			return;
	}
}

/** `Section "Review"`, or its id when it has no name. */
function nameOf(section: FlowSection): string {
	const label = section.label.trim();
	return `Section "${label === "" ? section.id : label}"`;
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function list(ids: readonly string[]): string {
	const quoted = ids.map((id) => `"${id}"`);
	const last = quoted.pop();
	return quoted.length === 0
		? (last ?? "")
		: `${quoted.join(", ")} and ${last}`;
}
