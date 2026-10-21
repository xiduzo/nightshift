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

	const cycles: string[][] = [];
	for (const component of components) {
		const members = new Set(component);
		// Start at the member that comes first in the file.
		const start = ids.find((id) => members.has(id));
		if (start === undefined) continue;
		if (component.length === 1 && !next.get(start)?.includes(start)) continue;
		cycles.push(cycleThrough(start, members, next));
	}
	return cycles.sort(
		(a, b) => ids.indexOf(a[0] ?? "") - ids.indexOf(b[0] ?? ""),
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
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
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
