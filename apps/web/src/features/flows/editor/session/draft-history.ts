// The undo history of the editor's draft. Every change is a step, except
// that changes of one gesture merge into one: a drag of nodes, or typing
// in one field. Undo and Redo walk the steps.

import type { Flow } from "@nightshift/flows";

/** The most steps Undo goes back. */
const MAX_STEPS = 100;

export type DraftHistory = {
	past: Flow[];
	present: Flow;
	future: Flow[];
	/** The gesture of the last change, and when it came. */
	last?: { key: string; at: number };
};

/**
 * A change that merges into the step before when that step has the same
 * key and came less than `within` ms ago. A drag of nodes is one key; the
 * fields of one node in the inspector are another.
 */
export type Merge = { key: string; at: number; within: number };

export function startHistory(flow: Flow): DraftHistory {
	return { past: [], present: flow, future: [] };
}

/**
 * The history after the draft became `next`. A change to the same flow,
 * as when a node "moves" to where it is, is no step.
 */
export function record(
	history: DraftHistory,
	next: Flow,
	merge?: Merge,
): DraftHistory {
	if (next === history.present) return history;
	const { last } = history;
	if (
		merge &&
		last?.key === merge.key &&
		merge.at - last.at < merge.within &&
		history.past.length > 0
	) {
		return {
			...history,
			present: next,
			future: [],
			last: { key: merge.key, at: merge.at },
		};
	}
	if (JSON.stringify(next) === JSON.stringify(history.present)) {
		return { ...history, present: next };
	}
	return {
		past: [...history.past, history.present].slice(-MAX_STEPS),
		present: next,
		future: [],
		last: merge && { key: merge.key, at: merge.at },
	};
}

export function undo(history: DraftHistory): DraftHistory {
	const previous = history.past.at(-1);
	if (previous === undefined) return history;
	return {
		past: history.past.slice(0, -1),
		present: previous,
		future: [history.present, ...history.future],
	};
}

export function redo(history: DraftHistory): DraftHistory {
	const [next, ...future] = history.future;
	if (next === undefined) return history;
	return {
		past: [...history.past, history.present],
		present: next,
		future,
	};
}
