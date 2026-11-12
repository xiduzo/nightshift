/** Loops in the graph of a flow. */

/**
 * One cycle per strongly connected component that loops (Tarjan), as the
 * node ids along a simple cycle in that component.
 */
export function findCycles(
	ids: readonly string[],
	edges: readonly { from: string; to: string }[],
): string[][] {
	const next = new Map<string, string[]>(ids.map((id) => [id, []]));
	for (const edge of edges) next.get(edge.from)?.push(edge.to);

	let counter = 0;
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const components: string[][] = [];

	const connect = (id: string) => {
		index.set(id, counter);
		low.set(id, counter);
		counter++;
		stack.push(id);
		onStack.add(id);
		for (const to of next.get(id) ?? []) {
			if (!index.has(to)) {
				connect(to);
				low.set(id, Math.min(low.get(id) ?? 0, low.get(to) ?? 0));
			} else if (onStack.has(to)) {
				low.set(id, Math.min(low.get(id) ?? 0, index.get(to) ?? 0));
			}
		}
		if (low.get(id) === index.get(id)) {
			const component: string[] = [];
			let member: string | undefined;
			do {
				member = stack.pop();
				if (member === undefined) break;
				onStack.delete(member);
				component.push(member);
			} while (member !== id);
			components.push(component);
		}
	};
	for (const id of ids) if (!index.has(id)) connect(id);

	// A chain is one component per node. Scanning the file to place each
	// one would read the node list once per node.
	const order = new Map<string, number>();
	for (let at = 0; at < ids.length; at++) {
		const id = ids[at];
		if (id !== undefined && !order.has(id)) order.set(id, at);
	}
	const cycles: string[][] = [];
	for (const component of components) {
		const only = component.length === 1 ? component[0] : undefined;
		if (only !== undefined && !next.get(only)?.includes(only)) continue;
		// Start at the member that comes first in the file.
		let start: string | undefined;
		let best = Number.POSITIVE_INFINITY;
		for (const id of component) {
			const at = order.get(id) ?? Number.POSITIVE_INFINITY;
			if (at < best) {
				best = at;
				start = id;
			}
		}
		if (start === undefined) continue;
		cycles.push(cycleThrough(start, new Set(component), next));
	}
	return cycles.sort(
		(a, b) => (order.get(a[0] ?? "") ?? 0) - (order.get(b[0] ?? "") ?? 0),
	);
}

/** A shortest path from `start` back to itself, inside one component. */
function cycleThrough(
	start: string,
	members: ReadonlySet<string>,
	next: ReadonlyMap<string, string[]>,
): string[] {
	const parent = new Map<string, string>();
	const queue = [start];
	for (let head = 0; head < queue.length; head++) {
		const id = queue[head] as string;
		for (const to of next.get(id) ?? []) {
			if (to === start) {
				const path = [id];
				for (let at = id; at !== start; ) {
					const up = parent.get(at);
					if (up === undefined) break;
					path.push(up);
					at = up;
				}
				return path.reverse();
			}
			if (members.has(to) && !parent.has(to)) {
				parent.set(to, id);
				queue.push(to);
			}
		}
	}
	return [start];
}
