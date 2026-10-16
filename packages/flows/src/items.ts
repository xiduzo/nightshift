import type { JsonValue } from "./schema";
import type { ListItem } from "./types";

/**
 * Blockers first: an item comes after every item of the list it is blocked
 * by. Among free items the source's order stays. A cycle of "blocked by"
 * links is an error that names the items.
 */
export function blockersFirst(
	items: readonly ListItem[],
): { ok: true; items: ListItem[] } | { ok: false; cycle: string[] } {
	const left = [...items];
	const out: ListItem[] = [];
	// An item blocked by itself is not waiting on anything (as in the script).
	const waitsOnLeft = (item: ListItem, ids: ReadonlySet<string>) =>
		item.blockedBy.some(
			(blocker) => blocker.id !== item.id && ids.has(blocker.id),
		);
	while (left.length > 0) {
		const ids = new Set(left.map((item) => item.id));
		const free = left.findIndex((item) => !waitsOnLeft(item, ids));
		if (free === -1) return { ok: false, cycle: findCycle(left) };
		out.push(...left.splice(free, 1));
	}
	return { ok: true, items: out };
}

/**
 * The ids along one cycle among items that all wait on another of them:
 * follow the first blocker that is left until an id repeats.
 */
function findCycle(left: readonly ListItem[]): string[] {
	const byId = new Map(left.map((item) => [item.id, item]));
	const path: string[] = [];
	for (let item = left[0]; item !== undefined; ) {
		const seen = path.indexOf(item.id);
		if (seen !== -1) return path.slice(seen);
		path.push(item.id);
		const self = item.id;
		const blocker = item.blockedBy.find(
			(entry) => entry.id !== self && byId.has(entry.id),
		);
		item = blocker === undefined ? undefined : byId.get(blocker.id);
	}
	return path;
}

/** How the engine sees one item during a For Each visit. */
export type ItemState = "done" | "failed" | "blocked" | "halted" | "running";

export type NextItem =
	| { kind: "item"; item: ListItem }
	/** Items are left, but each waits on a blocker that is not done yet (for example a person's gate). */
	| { kind: "waiting"; items: ListItem[] }
	| { kind: "none" };

/**
 * The next item to start: the first item (in blockers-first order) that is
 * not done before the run, has no state in this visit, and whose blockers
 * are all done (done before the run, or `done` in `states`). An item whose
 * blocker `failed` or is `blocked` is not returned: the engine marks it
 * blocked first (see `newlyBlocked`).
 */
export function nextItem(
	ordered: readonly ListItem[],
	states: Readonly<Record<string, ItemState>>,
): NextItem {
	const listed = new Map(ordered.map((item) => [item.id, item]));
	const isDone = (blocker: ListItem["dependsOn"][number]) =>
		states[blocker.id] === "done" ||
		(listed.get(blocker.id)?.done ?? blocker.done);
	// Left for the engine to mark blocked first.
	const doomed = new Set(
		newlyBlocked(ordered, states).map((entry) => entry.item.id),
	);

	const waiting: ListItem[] = [];
	for (const item of ordered) {
		if (item.done || Object.hasOwn(states, item.id) || doomed.has(item.id))
			continue;
		const blockers = item.blockedBy.filter((blocker) => blocker.id !== item.id);
		if (blockers.every(isDone)) return { kind: "item", item };
		waiting.push(item);
	}
	return waiting.length > 0
		? { kind: "waiting", items: waiting }
		: { kind: "none" };
}

/** Items without a state whose blocker failed or is blocked, transitively. */
export function newlyBlocked(
	ordered: readonly ListItem[],
	states: Readonly<Record<string, ItemState>>,
): { item: ListItem; blocker: string }[] {
	const stuck = new Set(
		Object.entries(states)
			.filter(([, state]) => state === "failed" || state === "blocked")
			.map(([id]) => id),
	);
	const out: { item: ListItem; blocker: string }[] = [];
	const marked = new Set<string>();
	// Repeat until nothing changes, so the order of the list does not matter.
	for (let changed = true; changed; ) {
		changed = false;
		for (const item of ordered) {
			if (item.done || Object.hasOwn(states, item.id) || marked.has(item.id))
				continue;
			const blocker = item.blockedBy.find(
				(entry) => entry.id !== item.id && stuck.has(entry.id),
			);
			if (blocker === undefined) continue;
			out.push({ item, blocker: blocker.id });
			marked.add(item.id);
			stuck.add(item.id);
			changed = true;
		}
	}
	return out;
}

/**
 * Turns a source's JSON value into list items: it must be an array. See
 * `forEachNodeSchema` for how `id`, `title`, `url`, `dependsOn` (or
 * `blockedBy`) and `done` are read from object elements. Duplicate ids are
 * an error.
 */
export function normalizeList(
	value: JsonValue,
): { ok: true; items: ListItem[] } | { ok: false; error: string } {
	throw new Error("Not implemented");
}
