import type { Flow } from "@nightshift/flows";

/** The editor's draft as Undo sees it: as it is now, and how to change it. */
export type UndoTarget = {
	readFlow: () => Flow;
	changeFlow: (change: (flow: Flow) => Flow) => void;
};

/**
 * Whether Undo can still bring back the draft before a change that made
 * `after`: the draft is `after`, or holds the same flow. A change that
 * only made a new object of the same flow, as the canvas does when a node
 * "moves" to where it is, does not end Undo. A real change since does:
 * Undo would throw it away.
 */
export function canUndo(current: Flow, after: Flow): boolean {
	return current === after || JSON.stringify(current) === JSON.stringify(after);
}

/**
 * Undoes the change from `before` to `after` while the draft still holds
 * `after`. Returns whether it did.
 */
export function undoDraft(
	target: UndoTarget,
	{ before, after }: { before: Flow; after: Flow },
): boolean {
	if (!canUndo(target.readFlow(), after)) return false;
	target.changeFlow(() => before);
	return true;
}
