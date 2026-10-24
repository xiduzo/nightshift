// The routes "Lay out" found, kept per browser so that a reload, or the run
// page of the same flow, draws them too. A route holds only while both of
// its nodes stay where the layout put them: move one, and its edges fall
// back to a plain step path until the next "Lay out".

import type { FlowNode } from "@nightshift/flows";
import type { EdgeGroup } from "./edge-groups";
import type { EdgeRoute, Point } from "./edge-route";

export type RouteRecord = {
	route: EdgeRoute;
	/** Where the source and the target node were when the layout routed. */
	from: Point;
	to: Point;
	/** The group's outcomes, in order, when the layout routed. */
	outcomes: string[];
};

/** By pair key (`EdgeGroup.key`). */
export type RouteBook = Record<string, RouteRecord>;

const STORAGE_PREFIX = "nightshift:flow-routes:";

/** The routes of a layout, with the positions they hold for. */
export function recordRoutes(
	nodes: readonly Pick<FlowNode, "id" | "position">[],
	groups: readonly EdgeGroup[],
	routes: ReadonlyMap<string, EdgeRoute>,
): RouteBook {
	const at = new Map(nodes.map((node) => [node.id, node.position]));
	const book: RouteBook = {};
	for (const group of groups) {
		const route = routes.get(group.key);
		const from = at.get(group.from);
		const to = at.get(group.to);
		if (!route || !from || !to) continue;
		book[group.key] = {
			route,
			from,
			to,
			outcomes: group.edges.map((edge) => edge.outcome),
		};
	}
	return book;
}

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** The group's route, while its nodes and outcomes are as they were. */
export function routeOf(
	book: RouteBook,
	group: EdgeGroup,
	at: ReadonlyMap<string, Point>,
): EdgeRoute | undefined {
	const record = book[group.key];
	const from = at.get(group.from);
	const to = at.get(group.to);
	if (!record || !from || !to) return undefined;
	if (!same(record.from, from) || !same(record.to, to)) return undefined;
	const outcomes = group.edges.map((edge) => edge.outcome);
	if (outcomes.join("\u0000") !== record.outcomes.join("\u0000")) {
		return undefined;
	}
	return record.route;
}

/** The routes this browser keeps for a flow. Empty when it keeps none. */
export function readRoutes(key: string): RouteBook {
	try {
		const stored = globalThis.localStorage?.getItem(STORAGE_PREFIX + key);
		const book: unknown = stored ? JSON.parse(stored) : {};
		return book && typeof book === "object" ? (book as RouteBook) : {};
	} catch {
		return {};
	}
}

export function writeRoutes(key: string, book: RouteBook): void {
	try {
		globalThis.localStorage?.setItem(
			STORAGE_PREFIX + key,
			JSON.stringify(book),
		);
	} catch {
		// Storage can be full or blocked. The routes still hold until a reload.
	}
}
