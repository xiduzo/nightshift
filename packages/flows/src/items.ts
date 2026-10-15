import type { SourceItem } from "./types";

/**
 * Blockers first: an item comes after every item of the list it is blocked
 * by. Among free items the source's order stays. A cycle of "blocked by"
 * links is an error that names the items.
 */
export function blockersFirst(
	items: readonly SourceItem[],
): { ok: true; items: SourceItem[] } | { ok: false; cycle: string[] } {
	throw new Error("Not implemented");
}

/** How the engine sees one item during a For Each visit. */
export type ItemState = "done" | "failed" | "blocked" | "halted" | "running";

export type NextItem =
	| { kind: "item"; item: SourceItem }
	/** Items are left, but each waits on a blocker that is not done yet (for example a person's gate). */
	| { kind: "waiting"; items: SourceItem[] }
	| { kind: "none" };

/**
 * The next item to start: the first item (in blockers-first order) that is
 * not done before the run, has no state in this visit, and whose blockers
 * are all done (done before the run, or `done` in `states`). An item whose
 * blocker `failed` or is `blocked` is not returned: the engine marks it
 * blocked first (see `newlyBlocked`).
 */
export function nextItem(
	ordered: readonly SourceItem[],
	states: Readonly<Record<string, ItemState>>,
): NextItem {
	throw new Error("Not implemented");
}

/** Items without a state whose blocker failed or is blocked, transitively. */
export function newlyBlocked(
	ordered: readonly SourceItem[],
	states: Readonly<Record<string, ItemState>>,
): { item: SourceItem; blocker: string }[] {
	throw new Error("Not implemented");
}
