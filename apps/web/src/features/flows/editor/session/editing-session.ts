// The flow editing session: the draft with its undo history and what was
// saved last. No React: the editor reads it through `useEditingSession`,
// and its handlers call the edits. React Flow and ELK stay outside.

import { now as clockNow } from "@nightshift/client";
import type { Flow } from "@nightshift/flows";
import {
	type DraftHistory,
	record,
	redo,
	startHistory,
	undo,
} from "./draft-history";

/** How long a pause ends a gesture: typing in one field after it is a new step. */
const GESTURE_PAUSE_MS = 1000;

/** A new draft, or how to make it from the draft as it is. */
export type DraftChange = Flow | ((draft: Flow) => Flow);

/**
 * Changes the draft. With `gesture`, the change merges into the step
 * before while it has the same gesture and came in time.
 */
export type DraftSetter = (change: DraftChange, gesture?: string) => void;

/** What the editor shows of the session. The same object until a change. */
export type SessionState = {
	/** The flow as the person edits it, saved or not. */
	draft: Flow;
	canUndo: boolean;
	canRedo: boolean;
	/** Counts the undos and redos: a panel that keeps its own copy of the draft starts again. */
	revision: number;
	/** The draft differs from what was saved last, or nothing is saved yet. */
	dirty: boolean;
	/** Something is saved: export and copy read the saved flow. */
	everSaved: boolean;
};

export type EditingSession = {
	/** The state now, also in a handler after the render that showed it. */
	get(): SessionState;
	/** Calls `listener` after each change. Returns how to stop. */
	subscribe(listener: () => void): () => void;
	/**
	 * A change of the draft: one step for Undo, or part of the step of its
	 * gesture (a drag of nodes, typing in one field).
	 */
	edit: DraftSetter;
	/** Goes one step back. False when there is none. */
	undo(): boolean;
	/** Goes one step forward again. False when there is none. */
	redo(): boolean;
	/** `snapshot` is the saved flow now. */
	saved(snapshot: Flow): void;
};

type Inner = {
	history: DraftHistory;
	savedJson: string;
	revision: number;
};

/**
 * A session on `initial`. With `saved`, `initial` is the flow on disk;
 * else nothing is saved yet. `now` is the clock that ends a gesture.
 */
export function createEditingSession(
	initial: Flow,
	{ saved, now = clockNow }: { saved: boolean; now?: () => number },
): EditingSession {
	let inner: Inner = {
		history: startHistory(initial),
		savedJson: saved ? JSON.stringify(initial) : "",
		revision: 0,
	};
	let state = stateOf(inner);
	const listeners = new Set<() => void>();

	const update = (change: Partial<Inner>) => {
		const next = { ...inner, ...change };
		if (
			next.history === inner.history &&
			next.savedJson === inner.savedJson &&
			next.revision === inner.revision
		)
			return;
		const before = inner;
		inner = next;
		state = stateOf(next, before, state);
		for (const listener of listeners) listener();
	};

	const edit: DraftSetter = (change, gesture) => {
		const merge =
			gesture === undefined
				? undefined
				: { key: gesture, at: now(), within: GESTURE_PAUSE_MS };
		const { history } = inner;
		const next =
			typeof change === "function" ? change(history.present) : change;
		update({ history: record(history, next, merge) });
	};

	const step = (walk: (history: DraftHistory) => DraftHistory) => {
		const history = walk(inner.history);
		if (history === inner.history) return false;
		update({ history, revision: inner.revision + 1 });
		return true;
	};

	return {
		get: () => state,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		edit,
		undo: () => step(undo),
		redo: () => step(redo),
		saved: (snapshot) => update({ savedJson: JSON.stringify(snapshot) }),
	};
}

/**
 * The state of `inner`. With the state `before` it, the dirty flag is
 * compared again only when the draft or the saved flow changed.
 */
function stateOf(
	inner: Inner,
	before?: Inner,
	previous?: SessionState,
): SessionState {
	const draft = inner.history.present;
	const same =
		before !== undefined &&
		previous !== undefined &&
		before.history.present === draft &&
		before.savedJson === inner.savedJson;
	return {
		draft,
		canUndo: inner.history.past.length > 0,
		canRedo: inner.history.future.length > 0,
		revision: inner.revision,
		dirty: same ? previous.dirty : JSON.stringify(draft) !== inner.savedJson,
		everSaved: inner.savedJson !== "",
	};
}
