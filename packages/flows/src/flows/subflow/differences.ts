import type { SubflowChange } from "./plan";
import { groupKey, type Planner } from "./planner";

/**
 * How a Section the flow can enter again works differently as a
 * Subflow: each run of the Subflow starts without node values, visits,
 * loop counts or Agent sessions of earlier passes.
 */
export function differences(plan: Planner): SubflowChange[] {
	const { flow, members } = plan;
	if (!reentered(plan)) return [];
	const changes: SubflowChange[] = [];
	const dominators = dominatorsOf(plan);
	const stale: { node: string; reads: string }[] = [];
	const visits: { node: string; reads: string }[] = [];
	const add = (
		list: { node: string; reads: string }[],
		node: string,
		reads: string,
	) => {
		if (!list.some((r) => r.node === node && r.reads === reads))
			list.push({ node, reads });
	};
	// Outer nodes the run reaches after each exit, before it comes back in.
	const after = new Map(
		plan.exits.map((exit) => [
			groupKey(exit),
			reachedOutside(
				plan,
				exit.edges.map((e) => e.to),
			),
		]),
	);
	for (const read of plan.reads) {
		if (!members.has(read.name)) continue;
		const label = "node" in read.reader ? read.reader.node : null;
		if (read.path[0] === "visit" && label !== null)
			add(visits, label, read.name);
		if (plan.inside(read.reader) && label !== null) {
			// The node's own id in a write reads the step that just ended.
			if (read.self && read.name === label) continue;
			const before = dominators.get(label);
			if (read.name === label || !before?.has(read.name))
				add(stale, label, read.name);
			continue;
		}
		if (label === null) continue;
		const missed = plan.exits.some(
			(exit) =>
				!dominators.get(exit.from)?.has(read.name) &&
				after.get(groupKey(exit))?.has(label),
		);
		if (missed) add(stale, label, read.name);
	}
	if (stale.length > 0)
		changes.push({
			kind: "differs",
			code: "reads-earlier-pass",
			reads: stale,
		});
	if (visits.length > 0)
		changes.push({ kind: "differs", code: "visit-per-call", reads: visits });
	const limited = flow.edges.filter(
		(e) => members.has(e.from) && members.has(e.to) && e.max !== undefined,
	);
	if (limited.length > 0)
		changes.push({
			kind: "differs",
			code: "loop-limit-per-call",
			edges: limited.map((e) => e.id),
		});
	const sessions = plan.inner.filter(
		(node) => node.type === "agent" && node.session === "resume",
	);
	if (sessions.length > 0)
		changes.push({
			kind: "differs",
			code: "session-per-call",
			nodes: sessions.map((node) => node.id),
		});
	return changes;
}

/** Whether the run can come back to the Section's entry after it left. */
function reentered(plan: Planner): boolean {
	const seen = new Set<string>();
	const queue = plan.exits.flatMap((exit) => exit.edges.map((e) => e.to));
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
		if (id === plan.entry) return true;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const edge of plan.flow.edges)
			if (edge.from === id) queue.push(edge.to);
	}
	return false;
}

/** The outer nodes reachable from `starts` without passing through the Section. */
function reachedOutside(plan: Planner, starts: readonly string[]): Set<string> {
	const seen = new Set<string>();
	const queue = [...starts];
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
		if (seen.has(id) || plan.members.has(id)) continue;
		seen.add(id);
		for (const edge of plan.flow.edges)
			if (edge.from === id) queue.push(edge.to);
	}
	return seen;
}

/**
 * For each node inside, the nodes inside that every path from the entry
 * to it passes through, itself included (the dominators).
 */
function dominatorsOf(plan: Planner): Map<string, Set<string>> {
	const ids = plan.inner.map((node) => node.id);
	const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
	for (const edge of plan.flow.edges) {
		if (plan.members.has(edge.from) && plan.members.has(edge.to))
			preds.get(edge.to)?.push(edge.from);
	}
	const dom = new Map<string, Set<string>>(
		ids.map((id) => [id, id === plan.entry ? new Set([id]) : new Set(ids)]),
	);
	for (let changed = true; changed; ) {
		changed = false;
		for (const id of ids) {
			if (id === plan.entry) continue;
			const sets = (preds.get(id) ?? []).map(
				(p) => dom.get(p) ?? new Set<string>(),
			);
			const meet = sets.length
				? new Set(
						[...(sets[0] ?? [])].filter((d) => sets.every((s) => s.has(d))),
					)
				: new Set<string>();
			meet.add(id);
			const old = dom.get(id);
			if (!old || old.size !== meet.size) {
				dom.set(id, meet);
				changed = true;
			}
		}
	}
	return dom;
}
