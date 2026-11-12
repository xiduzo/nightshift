/**
 * The shape of a Section in its flow: which nodes it holds, where the flow
 * enters it, and the edges that cross its edge. A Section is one connected
 * part of the flow with one entry (decision 2 of the canvas research), so
 * it shows as one box with one way in.
 */
import type { Flow, FlowEdge, FlowSection } from "../flow";
import { nodeOutcomes } from "../flow";
import { nodesWithin, sectionPath } from "./tree";

/**
 * Why a set of nodes cannot be a Section. Codes, not words: the editor
 * writes the words, `validateFlow` writes its own.
 * - `empty`: no nodes.
 * - `unknown-nodes`: ids that are not nodes of the flow.
 * - `in-other-section`: nodes that another Section holds already.
 * - `unknown-sections`: ids that are not Sections of the flow.
 * - `section-in-other-section`: Sections that another Section holds already.
 * - `holds-itself`: the Section itself, or a Section around it.
 * - `not-together`: the nodes and Sections are not all in the same
 *   Section, or not all outside every Section.
 * - `not-connected`: the nodes fall apart in `parts` (edges between them,
 *   in either direction, connect them).
 * - `no-entry`: no edge from outside leads in, and the start is not in it.
 * - `several-entries`: the flow enters it at more than one node.
 */
export type SectionProblem =
	| { code: "empty" }
	| { code: "unknown-nodes"; nodes: string[] }
	| {
			code: "in-other-section";
			nodes: { node: string; section: string }[];
	  }
	| { code: "unknown-sections"; sections: string[] }
	| {
			code: "section-in-other-section";
			sections: { section: string; holder: string }[];
	  }
	| { code: "holds-itself"; sections: string[] }
	| { code: "not-together" }
	| { code: "not-connected"; parts: string[][] }
	| { code: "no-entry" }
	| { code: "several-entries"; entries: string[] };

export type SectionCheck =
	| { ok: true; entry: string }
	| { ok: false; problems: SectionProblem[] };

export type SectionCheckOptions = {
	/**
	 * The id of the Section the nodes are for, when it exists already: its
	 * own nodes do not count as "in another Section".
	 */
	section?: string;
	/** The ids of the Sections that go inside it. */
	sections?: readonly string[];
	/**
	 * The Section the nodes and Sections move out of, to be inside the new
	 * one: holding them there does not count as "in another Section".
	 */
	from?: string;
	/**
	 * The Sections and edges of the flow, read once. The check of every
	 * Section passes the same one.
	 */
	index?: GraphIndex;
};

/**
 * Whether `nodeIds`, with the Sections `options.sections` inside, can be a
 * Section of `flow`: known nodes and Sections, none in another Section,
 * no Section inside itself, and all their nodes one connected part with
 * one entry. Returns the entry, else every problem found. Unknown ids are
 * left out of the other checks.
 */
export function canMakeSection(
	flow: Flow,
	nodeIds: readonly string[],
	options: SectionCheckOptions = {},
): SectionCheck {
	const problems: SectionProblem[] = [];
	const known = new Set(flow.nodes.map((node) => node.id));
	const own = unique(nodeIds).filter((id) => known.has(id));
	const unknown = unique(nodeIds).filter((id) => !known.has(id));
	if (unknown.length > 0)
		problems.push({ code: "unknown-nodes", nodes: unknown });

	const index = options.index ?? graphIndex(flow);
	const childIds = unique(options.sections ?? []);
	const unknownSections = childIds.filter(
		(id) => index.holders.find(id) === undefined,
	);
	if (unknownSections.length > 0)
		problems.push({ code: "unknown-sections", sections: unknownSections });
	// The Section and those around it cannot be inside it.
	const around = new Set(
		options.section === undefined
			? []
			: sectionPath(flow, options.section).map((section) => section.id),
	);
	const loops = childIds.filter((id) => around.has(id));
	if (loops.length > 0)
		problems.push({ code: "holds-itself", sections: loops });
	const children = childIds.flatMap((id) => {
		const child = index.holders.find(id);
		return child && !around.has(id) ? [child] : [];
	});

	const mine = new Set(
		[options.section, options.from].filter(
			(id): id is string => id !== undefined,
		),
	);
	const heldSections: { section: string; holder: string }[] = [];
	for (const child of children) {
		const holder = index.holders.sectionOf(child.id, mine);
		if (holder) heldSections.push({ section: child.id, holder });
	}
	if (heldSections.length > 0)
		problems.push({ code: "section-in-other-section", sections: heldSections });

	const members = unique([
		...own,
		...children.flatMap((child) => nodesWithin(flow, child)),
	]);
	if (members.length === 0) {
		problems.push({ code: "empty" });
		return { ok: false, problems };
	}

	const taken: { node: string; section: string }[] = [];
	for (const id of own) {
		const other = index.holders.nodeOf(id, mine);
		if (other) taken.push({ node: id, section: other });
	}
	if (taken.length > 0)
		problems.push({ code: "in-other-section", nodes: taken });

	const parts = connectedParts(members, index);
	if (parts.length > 1) problems.push({ code: "not-connected", parts });

	const entries = entriesOf(flow, new Set(members), index);
	if (entries.length === 0) problems.push({ code: "no-entry" });
	if (entries.length > 1) problems.push({ code: "several-entries", entries });

	const [entry] = entries;
	if (problems.length > 0 || entry === undefined)
		return { ok: false, problems };
	return { ok: true, entry };
}

/**
 * The edges that leave a Section on one outcome of one node. A Section's
 * box shows one handle for each, labelled "verdict · pass".
 */
export type SectionExit = {
	from: string;
	outcome: string;
	/** "<node> · <outcome>". */
	label: string;
	/** In file order. Several when the outcome has edges with a `max`. */
	edges: FlowEdge[];
};

/** The edges that cross a Section's frame. */
export type SectionBoundary = {
	/** Where the flow enters the Section. Null when it has no or several entries. */
	entry: string | null;
	/** Every node where the flow enters, in file order. */
	entries: string[];
	/** Whether the flow starts inside the Section. */
	start: boolean;
	/** The edges from outside into the Section, in file order. */
	incoming: FlowEdge[];
	/**
	 * The edges from inside to outside, one group per (node, outcome): in
	 * the order of the nodes in the flow, then of the node's outcomes.
	 */
	outgoing: SectionExit[];
};

/**
 * The boundary of the Section that holds `nodeIds`: its entry, the edges
 * that lead in, and the edges that leave, grouped by (node, outcome).
 * Unknown ids and edges to unknown nodes are left out.
 */
export function sectionBoundary(
	flow: Flow,
	nodeIds: readonly string[],
): SectionBoundary {
	const known = new Set(flow.nodes.map((node) => node.id));
	const members = new Set(nodeIds.filter((id) => known.has(id)));
	const entries = entriesOf(flow, members);
	const incoming: FlowEdge[] = [];
	const leaving = new Map<string, SectionExit>();
	for (const edge of flow.edges) {
		if (!known.has(edge.from) || !known.has(edge.to)) continue;
		const inside = members.has(edge.from);
		if (inside === members.has(edge.to)) continue;
		if (!inside) {
			incoming.push(edge);
			continue;
		}
		const key = `${edge.from}\u0000${edge.outcome}`;
		const exit = leaving.get(key);
		if (exit) exit.edges.push(edge);
		else {
			leaving.set(key, {
				from: edge.from,
				outcome: edge.outcome,
				label: `${edge.from} · ${edge.outcome}`,
				edges: [edge],
			});
		}
	}

	const nodeOrder = new Map(flow.nodes.map((node, at) => [node.id, at]));
	const outcomeOrder = (exit: SectionExit) => {
		const node = flow.nodes.find((candidate) => candidate.id === exit.from);
		const index = node ? nodeOutcomes(node).indexOf(exit.outcome) : -1;
		return index === -1 ? Number.MAX_SAFE_INTEGER : index;
	};
	const outgoing = [...leaving.values()].sort(
		(a, b) =>
			(nodeOrder.get(a.from) ?? 0) - (nodeOrder.get(b.from) ?? 0) ||
			outcomeOrder(a) - outcomeOrder(b),
	);

	return {
		entry: entries.length === 1 ? (entries[0] ?? null) : null,
		entries,
		start: members.has(flow.start),
		incoming,
		outgoing,
	};
}

/**
 * The Section that holds the node, if any: the first one that lists it.
 * That is the lowest Section around the node; `sectionPath` gives the
 * ones around it.
 */
export function sectionOf(flow: Flow, nodeId: string): FlowSection | undefined {
	return (flow.sections ?? []).find((section) =>
		section.nodes.includes(nodeId),
	);
}

/**
 * Which Section lists a node or a Section first, in file order. A Section
 * that lists itself is not its own parent.
 */
function sectionHolders(flow: Pick<Flow, "sections">) {
	const byId = new Map<string, FlowSection>();
	const nodeHolders = new Map<string, string[]>();
	const childHolders = new Map<string, string[]>();
	for (const section of flow.sections ?? []) {
		if (!byId.has(section.id)) byId.set(section.id, section);
		for (const id of section.nodes) {
			const list = nodeHolders.get(id);
			if (list) list.push(section.id);
			else nodeHolders.set(id, [section.id]);
		}
		for (const id of section.sections ?? []) {
			if (id === section.id) continue;
			const list = childHolders.get(id);
			if (list) list.push(section.id);
			else childHolders.set(id, [section.id]);
		}
	}
	const first = (
		map: Map<string, string[]>,
		id: string,
		skip: ReadonlySet<string>,
	) => {
		for (const holder of map.get(id) ?? []) {
			if (!skip.has(holder)) return holder;
		}
		return undefined;
	};
	return {
		find: (id: string) => byId.get(id),
		nodeOf: (id: string, skip: ReadonlySet<string>) =>
			first(nodeHolders, id, skip),
		sectionOf: (id: string, skip: ReadonlySet<string>) =>
			first(childHolders, id, skip),
	};
}

/** The edges and Sections of a flow, read once for every Section check. */
type GraphIndex = {
	holders: ReturnType<typeof sectionHolders>;
	incoming: Map<string, FlowEdge[]>;
	outgoing: Map<string, FlowEdge[]>;
	/** Where each node sits in the file, so an entry list keeps that order. */
	order: Map<string, number>;
};

function graphIndex(flow: Flow): GraphIndex {
	const known = new Set(flow.nodes.map((node) => node.id));
	const incoming = new Map<string, FlowEdge[]>();
	const outgoing = new Map<string, FlowEdge[]>();
	for (const edge of flow.edges) {
		if (!known.has(edge.from) || !known.has(edge.to)) continue;
		const into = incoming.get(edge.to);
		if (into) into.push(edge);
		else incoming.set(edge.to, [edge]);
		const out = outgoing.get(edge.from);
		if (out) out.push(edge);
		else outgoing.set(edge.from, [edge]);
	}
	return {
		holders: sectionHolders(flow),
		incoming,
		outgoing,
		order: new Map(flow.nodes.map((node, at) => [node.id, at])),
	};
}

/**
 * The check of every Section, each against one read of the flow. The
 * warnings of a flow (`checkSections`) use this on every change.
 */
export function sectionChecks(flow: Flow): {
	section: FlowSection;
	index: number;
	check: SectionCheck;
}[] {
	const index = graphIndex(flow);
	return (flow.sections ?? []).map((section, at) => ({
		section,
		index: at,
		check: canMakeSection(flow, section.nodes, {
			section: section.id,
			sections: section.sections ?? [],
			index,
		}),
	}));
}

/**
 * The nodes where the flow enters `members`: the start, and each target of
 * an edge from a node outside. In the order of the nodes in the flow.
 */
function entriesOf(
	flow: Flow,
	members: ReadonlySet<string>,
	index?: GraphIndex,
): string[] {
	const incoming = index?.incoming ?? edgesInto(flow);
	const entries = new Set<string>();
	if (members.has(flow.start)) entries.add(flow.start);
	for (const id of members) {
		for (const edge of incoming.get(id) ?? []) {
			if (!members.has(edge.from)) entries.add(edge.to);
		}
	}
	const order = index?.order;
	if (!order) {
		return flow.nodes.map((node) => node.id).filter((id) => entries.has(id));
	}
	return [...entries].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** Edges between known nodes, by their target. */
function edgesInto(flow: Flow): Map<string, FlowEdge[]> {
	return graphIndex(flow).incoming;
}

/**
 * The connected parts of `members`, counting edges between members in
 * either direction. Each part in the order of `members`, the parts by
 * their first member.
 */
function connectedParts(
	members: readonly string[],
	index: GraphIndex,
): string[][] {
	const inside = new Set(members);
	const neighbours = new Map<string, string[]>(members.map((id) => [id, []]));
	for (const id of members) {
		const list = neighbours.get(id);
		if (!list) continue;
		for (const edge of index.outgoing.get(id) ?? []) {
			if (inside.has(edge.to)) list.push(edge.to);
		}
		for (const edge of index.incoming.get(id) ?? []) {
			if (inside.has(edge.from)) list.push(edge.from);
		}
	}
	const seen = new Set<string>();
	const parts: string[][] = [];
	for (const first of members) {
		if (seen.has(first)) continue;
		const part = new Set<string>([first]);
		seen.add(first);
		const queue = [first];
		for (let head = 0; head < queue.length; head++) {
			const id = queue[head] as string;
			for (const next of neighbours.get(id) ?? []) {
				if (seen.has(next)) continue;
				seen.add(next);
				part.add(next);
				queue.push(next);
			}
		}
		parts.push(members.filter((id) => part.has(id)));
	}
	return parts;
}

function unique(ids: readonly string[]): string[] {
	return [...new Set(ids)];
}
