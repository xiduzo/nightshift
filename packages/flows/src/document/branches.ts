import type { Flow, FlowEdge, Outcome } from "./flow";

/**
 * Parallel branches: the shape of a fan-out and the Join where its
 * branches meet, read from the edges.
 *
 * Several edges that leave one node on one outcome and have no `max` are a
 * fan-out: the run takes all of them at once, and each edge starts a
 * branch. A branch is every node the walk can reach from the edge before
 * it reaches a Join. Edges with a `max` keep the rule of `nextEdge`: the
 * first that has not hit its max, then one edge without a max as the way
 * on. The checks of a whole flow (`validate/branches.ts`) say what a
 * fan-out must look like; the engine reads the same shape to run it.
 */

/** One branch of a fan-out. */
export type Branch = {
	/** The edge the branch starts on. */
	edge: FlowEdge;
	/** The branch's nodes in the order the walk reaches them, its first node first. No Join is in it. */
	nodes: string[];
	/** The Joins the branch reaches. */
	joins: string[];
	/** The branch leads back to the node that fans out. */
	loopsBack: boolean;
};

/** Several edges without a max on one outcome of one node: their branches run at once. */
export type FanOut = {
	from: string;
	outcome: Outcome;
	/** The edges without a max, one per branch, in file order. */
	edges: FlowEdge[];
	/** Edges with a max on the same outcome: a fan-out cannot have them. */
	bounded: FlowEdge[];
	branches: Branch[];
	/** The Join every branch reaches. Null when a branch reaches none, or the branches reach different ones. */
	join: string | null;
};

/** Where a node of a branch is: its fan-out and its branch. */
export type BranchPlace = { fanOut: FanOut; branch: Branch };

/** Whether these edges, all on one outcome of one node, are a fan-out: two or more without a max. */
export function isFanOut(edges: readonly Pick<FlowEdge, "max">[]): boolean {
	return edges.filter((edge) => edge.max === undefined).length >= 2;
}

/** The fan-outs of a flow, in the order of their first edge in the file. */
export function fanOutsOf(flow: Pick<Flow, "nodes" | "edges">): FanOut[] {
	const byOutcome = new Map<string, FlowEdge[]>();
	for (const edge of flow.edges) {
		const key = `${edge.from}\u0000${edge.outcome}`;
		byOutcome.set(key, [...(byOutcome.get(key) ?? []), edge]);
	}
	const joins = new Set(
		flow.nodes.filter((node) => node.type === "join").map((node) => node.id),
	);
	const fanOuts: FanOut[] = [];
	for (const edges of byOutcome.values()) {
		if (!isFanOut(edges)) continue;
		const [first] = edges;
		if (!first) continue;
		const open = edges.filter((edge) => edge.max === undefined);
		const branches = open.map((edge) =>
			branchFrom(flow, edge, first.from, joins),
		);
		const reached = new Set(branches.flatMap((branch) => branch.joins));
		const [join] = reached;
		const same =
			reached.size === 1 &&
			branches.every((branch) => branch.joins.length === 1);
		fanOuts.push({
			from: first.from,
			outcome: first.outcome,
			edges: open,
			bounded: edges.filter((edge) => edge.max !== undefined),
			branches,
			join: same && join !== undefined ? join : null,
		});
	}
	return fanOuts;
}

/**
 * The branch of each node that is on one, by node id. A node on several
 * branches (a flow the checks refuse) keeps the first.
 */
export function branchPlaces(
	flow: Pick<Flow, "nodes" | "edges">,
): Map<string, BranchPlace> {
	const places = new Map<string, BranchPlace>();
	for (const fanOut of fanOutsOf(flow)) {
		for (const branch of fanOut.branches) {
			for (const id of branch.nodes) {
				if (!places.has(id)) places.set(id, { fanOut, branch });
			}
		}
	}
	return places;
}

/** Every node the walk reaches from `edge` before a Join, without passing the node that fans out. */
function branchFrom(
	flow: Pick<Flow, "edges">,
	edge: FlowEdge,
	source: string,
	joins: ReadonlySet<string>,
): Branch {
	const nodes: string[] = [];
	const reached: string[] = [];
	const seen = new Set<string>();
	let loopsBack = false;
	const queue = [edge.to];
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
		if (seen.has(id)) continue;
		seen.add(id);
		if (id === source) {
			loopsBack = true;
			continue;
		}
		if (joins.has(id)) {
			reached.push(id);
			continue;
		}
		nodes.push(id);
		for (const next of flow.edges) {
			if (next.from === id) queue.push(next.to);
		}
	}
	return { edge, nodes, joins: reached, loopsBack };
}
