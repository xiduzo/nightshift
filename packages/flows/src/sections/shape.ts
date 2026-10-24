/**
 * The shape of a Section in its flow: which nodes it holds, where the flow
 * enters it, and the edges that cross its frame. A Section is one connected
 * part of the flow with one entry (decision 2 of the canvas research), so
 * it folds into one box with one way in.
 */
import type { Flow, FlowEdge, FlowSection } from "../document";
import { nodeOutcomes } from "../document";

/**
 * Why a set of nodes cannot be a Section. Codes, not words: the editor
 * writes the words, `validateFlow` writes its own.
 * - `empty`: no nodes.
 * - `unknown-nodes`: ids that are not nodes of the flow.
 * - `in-other-section`: nodes that another Section holds already.
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
};

/**
 * Whether `nodeIds` can be a Section of `flow`: known nodes, none in
 * another Section, one connected part, and one entry. Returns the entry,
 * else every problem found. Unknown ids are left out of the other checks.
 */
export function canMakeSection(
	flow: Flow,
	nodeIds: readonly string[],
	options: SectionCheckOptions = {},
): SectionCheck {
	const problems: SectionProblem[] = [];
	const known = new Set(flow.nodes.map((node) => node.id));
	const members = unique(nodeIds).filter((id) => known.has(id));
	const unknown = unique(nodeIds).filter((id) => !known.has(id));
	if (unknown.length > 0)
		problems.push({ code: "unknown-nodes", nodes: unknown });
	if (members.length === 0) {
		problems.push({ code: "empty" });
		return { ok: false, problems };
	}

	const taken: { node: string; section: string }[] = [];
	for (const id of members) {
		const other = (flow.sections ?? []).find(
			(section) => section.id !== options.section && section.nodes.includes(id),
		);
		if (other) taken.push({ node: id, section: other.id });
	}
	if (taken.length > 0)
		problems.push({ code: "in-other-section", nodes: taken });

	const parts = connectedParts(flow, members);
	if (parts.length > 1) problems.push({ code: "not-connected", parts });

	const entries = entriesOf(flow, new Set(members));
	if (entries.length === 0) problems.push({ code: "no-entry" });
	if (entries.length > 1) problems.push({ code: "several-entries", entries });

	const [entry] = entries;
	if (problems.length > 0 || entry === undefined)
		return { ok: false, problems };
	return { ok: true, entry };
}

/**
 * The edges that leave a Section on one outcome of one node. A folded
 * Section shows one handle for each, labelled "verdict · pass".
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

	const nodeOrder = new Map(flow.nodes.map((node, index) => [node.id, index]));
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

/** The Section that holds the node, if any: the first one that lists it. */
export function sectionOf(flow: Flow, nodeId: string): FlowSection | undefined {
	return (flow.sections ?? []).find((section) =>
		section.nodes.includes(nodeId),
	);
}

/**
 * The nodes where the flow enters `members`: the start, and each target of
 * an edge from a node outside. In the order of the nodes in the flow.
 */
function entriesOf(flow: Flow, members: ReadonlySet<string>): string[] {
	const known = new Set(flow.nodes.map((node) => node.id));
	const entries = new Set<string>();
	if (members.has(flow.start)) entries.add(flow.start);
	for (const edge of flow.edges) {
		if (
			known.has(edge.from) &&
			!members.has(edge.from) &&
			members.has(edge.to)
		) {
			entries.add(edge.to);
		}
	}
	return flow.nodes.map((node) => node.id).filter((id) => entries.has(id));
}

/**
 * The connected parts of `members`, counting edges between members in
 * either direction. Each part in the order of `members`, the parts by
 * their first member.
 */
function connectedParts(flow: Flow, members: readonly string[]): string[][] {
	const inside = new Set(members);
	const neighbours = new Map<string, string[]>(members.map((id) => [id, []]));
	for (const edge of flow.edges) {
		if (!inside.has(edge.from) || !inside.has(edge.to)) continue;
		neighbours.get(edge.from)?.push(edge.to);
		neighbours.get(edge.to)?.push(edge.from);
	}
	const seen = new Set<string>();
	const parts: string[][] = [];
	for (const first of members) {
		if (seen.has(first)) continue;
		const part = new Set<string>([first]);
		seen.add(first);
		const queue = [first];
		for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
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
