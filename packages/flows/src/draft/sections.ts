/** Edits of the flow's Sections: add, change and remove, and keep them in step with the nodes. */
import type { Flow, FlowSection } from "../flow";
import {
	canMakeSection,
	parentSection,
	type SectionProblem,
	sectionOf,
} from "../sections";

/** What a new Section shows. The label defaults to "Section". */
export type SectionFields = Partial<
	Pick<FlowSection, "label" | "color" | "description">
>;

/**
 * Adds a Section around `nodeIds` and the Sections `sectionIds` when they
 * can form one (`canMakeSection`). They must all be in the same Section,
 * or all in none: the new Section takes their place there. Its id comes
 * from the label ("Review" → `review`), else `section`. Its nodes are kept
 * in the order of the flow. Else the problems, and no change.
 */
export function addSection(
	flow: Flow,
	nodeIds: readonly string[],
	fields: SectionFields = {},
	sectionIds: readonly string[] = [],
):
	| { ok: true; flow: Flow; id: string }
	| { ok: false; problems: SectionProblem[] } {
	const holders = [
		...nodeIds.map((id) => sectionOf(flow, id)?.id),
		...sectionIds.map((id) => parentSection(flow, id)?.id),
	];
	const home = holders[0];
	const together = holders.every((holder) => holder === home);
	const check = canMakeSection(flow, nodeIds, {
		sections: sectionIds,
		...(home !== undefined && { from: home }),
	});
	if (!together) {
		const problems: SectionProblem[] = [{ code: "not-together" }];
		if (!check.ok) problems.push(...check.problems);
		return { ok: false, problems };
	}
	if (!check.ok) return check;
	const label = fields.label ?? "Section";
	const id = uniqueSectionId(flow, slug(label));
	const members = new Set(nodeIds);
	const inside = new Set(sectionIds);
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
		...(inside.size > 0 && {
			sections: (flow.sections ?? [])
				.map((other) => other.id)
				.filter((other) => inside.has(other)),
		}),
	};
	// The Section they were in now holds the new one in their place.
	const sections = (flow.sections ?? []).map((other) => {
		if (other.id !== home) return other;
		const kept = (other.sections ?? []).filter((child) => !inside.has(child));
		return {
			...other,
			nodes: other.nodes.filter((node) => !members.has(node)),
			sections: [...kept, id],
		};
	});
	return {
		ok: true,
		flow: { ...flow, sections: [...sections, section] },
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

/**
 * Removes the Section, not its nodes. Its nodes and the Sections inside it
 * go to the Section around it, if any. No Sections left: the file has no
 * `sections` at all.
 */
export function removeSection(flow: Flow, id: string): Flow {
	const removed = (flow.sections ?? []).find((section) => section.id === id);
	if (!removed) return flow;
	const parent = parentSection(flow, id);
	return withSections(
		flow,
		(flow.sections ?? []).flatMap((section) => {
			if (section.id === id) return [];
			if (section.id !== parent?.id) return [section];
			const { sections: inner = [], ...rest } = section;
			const sections = inner.flatMap((child) =>
				child === id ? (removed.sections ?? []) : [child],
			);
			return [
				{
					...rest,
					nodes: [...section.nodes, ...removed.nodes],
					...(sections.length > 0 && { sections }),
				},
			];
		}),
	);
}

/**
 * Removes the Section, every Section inside it, and the mention of it in
 * the Section around it. Not the nodes.
 */
export function removeSectionAndInside(flow: Flow, id: string): Flow {
	const gone = new Set<string>([id]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const section of flow.sections ?? []) {
			if (!gone.has(section.id)) continue;
			for (const child of section.sections ?? []) {
				if (gone.has(child)) continue;
				gone.add(child);
				grew = true;
			}
		}
	}
	return withoutSections(flow, gone);
}

/**
 * Takes a removed node out of its Section. A Section with no nodes and no
 * Sections left goes, and so on outward.
 */
export function sectionsWithoutNode(flow: Flow, nodeId: string): Flow {
	if (!flow.sections) return flow;
	const next = flow.sections.map((section) =>
		section.nodes.includes(nodeId)
			? { ...section, nodes: section.nodes.filter((id) => id !== nodeId) }
			: section,
	);
	return withoutEmpty({ ...flow, sections: next });
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
export function uniqueSectionId(flow: Flow, base: string): string {
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

/** Without the Sections `gone`, also in the `sections` of the others. */
function withoutSections(flow: Flow, gone: ReadonlySet<string>): Flow {
	return withSections(
		flow,
		(flow.sections ?? []).flatMap((section) => {
			if (gone.has(section.id)) return [];
			if (!section.sections?.some((child) => gone.has(child))) return [section];
			const { sections: inner, ...rest } = section;
			const kept = inner.filter((child) => !gone.has(child));
			return [kept.length > 0 ? { ...rest, sections: kept } : rest];
		}),
	);
}

/** Without the Sections that hold nothing, until none is left. */
function withoutEmpty(flow: Flow): Flow {
	let next = flow;
	for (;;) {
		const known = new Set((next.sections ?? []).map((section) => section.id));
		const empty = new Set(
			(next.sections ?? [])
				.filter(
					(section) =>
						section.nodes.length === 0 &&
						!(section.sections ?? []).some((child) => known.has(child)),
				)
				.map((section) => section.id),
		);
		if (empty.size === 0) return withSections(next, next.sections ?? []);
		next = withoutSections(next, empty);
	}
}

function withSections(flow: Flow, sections: FlowSection[]): Flow {
	const { sections: _, ...rest } = flow;
	return sections.length > 0 ? { ...rest, sections } : rest;
}
