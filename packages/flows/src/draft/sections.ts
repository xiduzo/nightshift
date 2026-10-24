/** Edits of the flow's Sections: add, change and remove, and keep them in step with the nodes. */
import type { Flow, FlowSection } from "../document";
import { canMakeSection, type SectionProblem } from "../sections";

/** What a new Section shows. The label defaults to "Section". */
export type SectionFields = Partial<
	Pick<FlowSection, "label" | "color" | "description">
>;

/**
 * Adds a Section around `nodeIds` when they can form one (`canMakeSection`).
 * Its id comes from the label ("Review" → `review`), else `section`. Its
 * nodes are kept in the order of the flow. Else the problems, and no change.
 */
export function addSection(
	flow: Flow,
	nodeIds: readonly string[],
	fields: SectionFields = {},
):
	| { ok: true; flow: Flow; id: string }
	| { ok: false; problems: SectionProblem[] } {
	const check = canMakeSection(flow, nodeIds);
	if (!check.ok) return check;
	const label = fields.label ?? "Section";
	const id = uniqueSectionId(flow, slug(label));
	const members = new Set(nodeIds);
	const section: FlowSection = {
		id,
		label,
		...(fields.color !== undefined && { color: fields.color }),
		...(fields.description !== undefined && {
			description: fields.description,
		}),
		nodes: flow.nodes
			.map((node) => node.id)
			.filter((node) => members.has(node)),
	};
	return {
		ok: true,
		flow: { ...flow, sections: [...(flow.sections ?? []), section] },
		id,
	};
}

/**
 * Changes one Section. It does not check the result: `validateFlow` warns
 * when its nodes no longer form one. Use `canMakeSection` with
 * `{ section: id }` before a change of its nodes.
 */
export function updateSection(
	flow: Flow,
	id: string,
	change: (section: FlowSection) => FlowSection,
): Flow {
	if (!flow.sections) return flow;
	return {
		...flow,
		sections: flow.sections.map((section) =>
			section.id === id ? change(section) : section,
		),
	};
}

/** Removes the Section, not its nodes. No Sections left: the file has no `sections` at all. */
export function removeSection(flow: Flow, id: string): Flow {
	return withSections(
		flow,
		(flow.sections ?? []).filter((section) => section.id !== id),
	);
}

/** Takes a removed node out of its Section. A Section with no nodes left goes. */
export function sectionsWithoutNode(flow: Flow, nodeId: string): Flow {
	if (!flow.sections) return flow;
	return withSections(
		flow,
		flow.sections
			.map((section) =>
				section.nodes.includes(nodeId)
					? { ...section, nodes: section.nodes.filter((id) => id !== nodeId) }
					: section,
			)
			.filter((section) => section.nodes.length > 0),
	);
}

/** Renames a node in the Section that holds it. */
export function sectionsWithRenamedNode(
	flow: Flow,
	from: string,
	to: string,
): Flow {
	if (!flow.sections) return flow;
	return {
		...flow,
		sections: flow.sections.map((section) =>
			section.nodes.includes(from)
				? {
						...section,
						nodes: section.nodes.map((id) => (id === from ? to : id)),
					}
				: section,
		),
	};
}

/** `base`, else `base-2`, `base-3`, … whichever no Section uses yet. */
function uniqueSectionId(flow: Flow, base: string): string {
	const taken = new Set((flow.sections ?? []).map((section) => section.id));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const id = `${base}-${n}`;
		if (!taken.has(id)) return id;
	}
}

/** "Code review" → `code-review`. Nothing left: `section`. */
function slug(label: string): string {
	const id = label
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return id === "" ? "section" : id;
}

function withSections(flow: Flow, sections: FlowSection[]): Flow {
	const { sections: _, ...rest } = flow;
	return sections.length > 0 ? { ...rest, sections } : rest;
}
