/**
 * What changes between two versions of a flow: the editor's draft and an
 * assistant's proposal. Pure data, so the canvas can mark new, removed and
 * changed nodes and edges, and a badge can count them.
 *
 * Nodes and Sections match by id; inputs, outputs and variables by name.
 * Edges match by id, then by `from`, `outcome` and `to`: an agent that
 * writes the whole flow again often gives the same edge a new id, and that
 * is not a change. A node that only moved on the canvas is in `moved`, not
 * in `changed`, so the canvas does not mark it.
 */
import type {
	Flow,
	FlowEdge,
	FlowInputDef,
	FlowNode,
	FlowOutputDef,
	FlowSection,
	FlowVariableDef,
} from "../flow";

/** A node that is in both versions with other fields. */
export type NodeChange = {
	id: string;
	before: FlowNode;
	after: FlowNode;
	/**
	 * The fields that differ, by their name in the file (`prompt`, `label`,
	 * `outcomes`, `output`, `set`, `type`...), sorted. Never `position`:
	 * `moved` says whether it moved too.
	 */
	fields: string[];
	moved: boolean;
};

/** A node that only moved on the canvas. */
export type NodeMove = {
	id: string;
	before: FlowNode["position"];
	after: FlowNode["position"];
};

/** An item of a list in both versions, with the fields that differ, sorted. */
export type ItemChange<T> = { before: T; after: T; fields: string[] };

/** What was added, removed and changed in one list of the flow. */
export type ListDiff<T> = {
	added: T[];
	removed: T[];
	changed: ItemChange<T>[];
};

export type FlowDiff = {
	nodes: {
		added: FlowNode[];
		removed: FlowNode[];
		changed: NodeChange[];
		moved: NodeMove[];
	};
	/** A changed edge keeps the id it has in each version (`before.id`, `after.id`). */
	edges: ListDiff<FlowEdge>;
	inputs: ListDiff<FlowInputDef>;
	outputs: ListDiff<FlowOutputDef>;
	variables: ListDiff<FlowVariableDef>;
	sections: ListDiff<FlowSection>;
	/**
	 * The flow's own fields that differ (`start`, `description`, `policy`,
	 * `version`), sorted. Lists are in their own part above.
	 */
	flow: string[];
};

/** The fields of a flow that are lists of their own part of the diff. */
const listFields = new Set([
	"nodes",
	"edges",
	"inputs",
	"outputs",
	"variables",
	"sections",
]);

/** The changes from `before` to `after`. Both are flows as the schema reads them. */
export function diffFlows(before: Flow, after: Flow): FlowDiff {
	return {
		nodes: diffNodes(before.nodes, after.nodes),
		edges: diffEdges(before.edges, after.edges),
		inputs: diffList(before.inputs, after.inputs, (i) => i.name),
		outputs: diffList(before.outputs, after.outputs, (o) => o.name),
		variables: diffList(
			before.variables ?? [],
			after.variables ?? [],
			(v) => v.name,
		),
		sections: diffList(
			before.sections ?? [],
			after.sections ?? [],
			(s) => s.id,
		),
		flow: changedFields(before, after).filter((key) => !listFields.has(key)),
	};
}

/** Counts of a diff, for a badge such as "3 new steps, 1 changed". */
export type FlowDiffSummary = {
	/** Steps (nodes) added, removed and changed. A node that only moved is not changed. */
	added: number;
	removed: number;
	changed: number;
	/** Nodes that only moved. */
	moved: number;
	/** Edges added, removed or changed. */
	edges: number;
	/** Inputs, outputs, variables, Sections and the flow's own fields that changed. */
	other: number;
	/** Whether anything but the position of nodes changed. */
	empty: boolean;
};

export function flowDiffSummary(diff: FlowDiff): FlowDiffSummary {
	const count = (list: ListDiff<unknown>) =>
		list.added.length + list.removed.length + list.changed.length;
	const summary = {
		added: diff.nodes.added.length,
		removed: diff.nodes.removed.length,
		changed: diff.nodes.changed.length,
		moved: diff.nodes.moved.length,
		edges: count(diff.edges),
		other:
			count(diff.inputs) +
			count(diff.outputs) +
			count(diff.variables) +
			count(diff.sections) +
			diff.flow.length,
	};
	return {
		...summary,
		empty:
			summary.added +
				summary.removed +
				summary.changed +
				summary.edges +
				summary.other ===
			0,
	};
}

function diffNodes(before: FlowNode[], after: FlowNode[]): FlowDiff["nodes"] {
	const { added, removed, pairs } = match(before, after, (n) => n.id);
	const changed: NodeChange[] = [];
	const moved: NodeMove[] = [];
	for (const [old, next] of pairs) {
		const all = changedFields(old, next);
		const fields = all.filter((field) => field !== "position");
		const didMove = all.includes("position");
		if (fields.length > 0) {
			changed.push({
				id: next.id,
				before: old,
				after: next,
				fields,
				moved: didMove,
			});
		} else if (didMove) {
			moved.push({ id: next.id, before: old.position, after: next.position });
		}
	}
	return { added, removed, changed, moved };
}

/**
 * Edges by id first. An edge left over on each side with the same `from`,
 * `outcome` and `to` is the same edge under a new id: changed only when
 * another field (`max`) differs.
 */
function diffEdges(before: FlowEdge[], after: FlowEdge[]): ListDiff<FlowEdge> {
	const byId = diffList(before, after, (e) => e.id);
	const ends = (e: FlowEdge) => JSON.stringify([e.from, e.outcome, e.to]);
	const byEnds = match(byId.removed, byId.added, ends);
	const changed = [...byId.changed];
	for (const [old, next] of byEnds.pairs) {
		const fields = changedFields(old, next).filter((field) => field !== "id");
		if (fields.length > 0) changed.push({ before: old, after: next, fields });
	}
	return { added: byEnds.added, removed: byEnds.removed, changed };
}

function diffList<T extends object>(
	before: T[],
	after: T[],
	key: (item: T) => string,
): ListDiff<T> {
	const { added, removed, pairs } = match(before, after, key);
	const changed: ItemChange<T>[] = [];
	for (const [old, next] of pairs) {
		const fields = changedFields(old, next);
		if (fields.length > 0) changed.push({ before: old, after: next, fields });
	}
	return { added, removed, changed };
}

/**
 * Pairs the items of both lists by key, in the order of `after`. The first
 * item of a key wins: a list with a key twice is the validator's issue.
 */
function match<T>(
	before: T[],
	after: T[],
	key: (item: T) => string,
): { added: T[]; removed: T[]; pairs: [T, T][] } {
	const old = new Map<string, T>();
	for (const item of before) if (!old.has(key(item))) old.set(key(item), item);
	const seen = new Set<string>();
	const added: T[] = [];
	const pairs: [T, T][] = [];
	for (const item of after) {
		const k = key(item);
		if (seen.has(k)) continue;
		seen.add(k);
		const was = old.get(k);
		if (was === undefined) added.push(item);
		else pairs.push([was, item]);
	}
	const removed = [...old].filter(([k]) => !seen.has(k)).map(([, v]) => v);
	return { added, removed, pairs };
}

/** The keys whose values differ, sorted. A key set to undefined counts as left out. */
function changedFields(before: object, after: object): string[] {
	const a = before as Record<string, unknown>;
	const b = after as Record<string, unknown>;
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [...keys].filter((key) => !same(a[key], b[key])).sort();
}

/** Deep equality of JSON values: key order does not count, array order does. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
			return false;
		return a.every((item, i) => same(item, b[i]));
	}
	return changedFields(a, b).length === 0;
}
