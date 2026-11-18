/** The cycles in the imports between the verticals of a workspace (rule l). */

export type Edges = Map<string, Map<string, string>>;

/**
 * The groups of verticals that import each other (the strongly connected
 * components with more than one vertical, by Tarjan), each sorted.
 */
export function cyclicGroups(edges: Edges): string[][] {
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const groups: string[][] = [];
	const visit = (node: string): void => {
		index.set(node, index.size);
		low.set(node, index.get(node) as number);
		stack.push(node);
		onStack.add(node);
		for (const next of edges.get(node)?.keys() ?? []) {
			if (!index.has(next)) {
				visit(next);
				low.set(
					node,
					Math.min(low.get(node) as number, low.get(next) as number),
				);
			} else if (onStack.has(next)) {
				low.set(
					node,
					Math.min(low.get(node) as number, index.get(next) as number),
				);
			}
		}
		if (low.get(node) !== index.get(node)) return;
		const group: string[] = [];
		let member: string | undefined;
		do {
			member = stack.pop() as string;
			onStack.delete(member);
			group.push(member);
		} while (member !== node);
		if (group.length > 1) groups.push(group.sort());
	};
	for (const node of [...edges.keys()].sort())
		if (!index.has(node)) visit(node);
	return groups.sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));
}

/** The shortest cycle through the first vertical of `group`: [a, b, …, a]. */
export function shortestCycle(edges: Edges, group: string[]): string[] {
	const start = group[0] as string;
	const members = new Set(group);
	const previous = new Map<string, string>();
	const queue = [start];
	while (queue.length) {
		const node = queue.shift() as string;
		for (const next of [...(edges.get(node)?.keys() ?? [])].sort()) {
			if (!members.has(next)) continue;
			if (next === start) {
				const chain: string[] = [];
				for (let at = node; at !== start; at = previous.get(at) as string)
					chain.unshift(at);
				return [start, ...chain, start];
			}
			if (!previous.has(next)) {
				previous.set(next, node);
				queue.push(next);
			}
		}
	}
	return [start, start];
}
