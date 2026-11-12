// The flow editing session: the draft with its undo history, what was
// saved last, what is selected and which Section is open. No React: the
// editor reads it through `useEditingSession`, and its handlers call the
// edits. React Flow and ELK stay outside: the canvas calls `edit`, `select`
// and `openSection`.

import { now as clockNow } from "@nightshift/client";
import {
	addSection,
	type Flow,
	nodesWithin,
	parentSection,
	type SectionProblem,
	sectionOf,
	sectionPath,
	updateSection,
} from "@nightshift/flows";
import {
	type Selection,
	type SelectionSetter,
	selectedNodeIds,
	selectedSectionIds,
	selectionIn,
} from "../selection";
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
type DraftChange = Flow | ((draft: Flow) => Flow);

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
	selection: Selection;
	/**
	 * The Section whose nodes alone show on the canvas, or null for the
	 * whole flow. It may name a Section the draft lost to an undo: the
	 * canvas shows the whole flow then, and Redo opens it again.
	 */
	openSection: string | null;
	/** The Section made last: its inspector asks for a name first. */
	madeSection: string | null;
};

export type EditingSession = {
	/** The state now, also in a handler after the render that showed it. */
	get(): SessionState;
	/** Calls `listener` after each change. Returns how to stop. */
	subscribe(listener: () => void): () => void;
	/**
	 * A change of the draft: one step for Undo, or part of the step of its
	 * `gesture` (a drag of nodes, typing in one field). The canvas, the
	 * inspector, the chat and Suggest change the draft this way.
	 */
	edit(change: DraftChange, gesture?: string): void;
	/**
	 * `next` adds nodes or a pasted Section to the draft, as one step. While
	 * a Section is open, they join it: a node in no Section joins it, and a
	 * pasted Section joins it with its nodes.
	 */
	add(next: Flow): void;
	/**
	 * Goes one step back, and drops from the selection what the draft lost.
	 * False when there is no step.
	 */
	undo(): boolean;
	/** Goes one step forward again, as `undo` goes back. */
	redo(): boolean;
	/** `snapshot` is the saved flow now. */
	saved(snapshot: Flow): void;
	select: SelectionSetter;
	/**
	 * Selects the node and shows the level it is on: the Section that holds
	 * it, or the whole flow. True when the canvas stays on the level it
	 * shows: the editor then brings the node into view.
	 */
	selectNode(nodeId: string): boolean;
	/** Shows the inside of a Section on the canvas, or the whole flow (null). */
	openSection(sectionId: string | null): void;
	/**
	 * A Section of the nodes and the Sections `sectionIds`, selected, as one
	 * step. Its problems when they cannot form one, and no change.
	 */
	makeSection(
		nodeIds: readonly string[],
		sectionIds?: readonly string[],
	): { ok: true; id: string } | { ok: false; problems: SectionProblem[] };
	/**
	 * Runs after each render that showed a change: something selected
	 * outside the open Section shows the whole flow again. It waits for the
	 * render, so a handler that changes the draft and then the selection
	 * (a rename, a cut) counts only for where it ends.
	 */
	settle(): void;
};

type Inner = {
	history: DraftHistory;
	savedJson: string;
	revision: number;
	selection: Selection;
	openSection: string | null;
	madeSection: string | null;
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
		selection: null,
		openSection: null,
		madeSection: null,
	};
	let state = stateOf(inner);
	const listeners = new Set<() => void>();

	const update = (change: Partial<Inner>) => {
		const next = { ...inner, ...change };
		const keys = Object.keys(next) as (keyof Inner)[];
		if (keys.every((key) => next[key] === inner[key])) return;
		const before = inner;
		inner = next;
		state = stateOf(next, before, state);
		for (const listener of listeners) listener();
	};

	const recorded = (change: DraftChange, gesture?: string) => {
		const merge =
			gesture === undefined
				? undefined
				: { key: gesture, at: now(), within: GESTURE_PAUSE_MS };
		const { history } = inner;
		const next =
			typeof change === "function" ? change(history.present) : change;
		return record(history, next, merge);
	};

	const step = (walk: (history: DraftHistory) => DraftHistory) => {
		const history = walk(inner.history);
		if (history === inner.history) return false;
		// What the draft lost leaves the selection in the same step, so the
		// open Section stays: `settle` judges only what is still there.
		update({
			history,
			revision: inner.revision + 1,
			selection: selectionIn(history.present, inner.selection),
		});
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
		edit: (change, gesture) => update({ history: recorded(change, gesture) }),
		add: (next) =>
			update({
				history: recorded((current) =>
					joinOpenSection(current, next, inner.openSection),
				),
			}),
		undo: () => step(undo),
		redo: () => step(redo),
		saved: (snapshot) => update({ savedJson: JSON.stringify(snapshot) }),
		select: (change) =>
			update({
				selection:
					typeof change === "function" ? change(inner.selection) : change,
			}),
		selectNode: (nodeId) => {
			const holder = sectionOf(inner.history.present, nodeId);
			const selection: Selection = { kind: "node", id: nodeId };
			const level = holder?.id ?? null;
			if (level === inner.openSection) {
				update({ selection });
				return true;
			}
			update({ selection, openSection: level });
			return false;
		},
		openSection: (sectionId) => update({ openSection: sectionId }),
		makeSection: (nodeIds, sectionIds = []) => {
			const result = addSection(inner.history.present, nodeIds, {}, sectionIds);
			if (!result.ok) return result;
			update({
				history: recorded(result.flow),
				selection: { kind: "section", id: result.id },
				madeSection: result.id,
			});
			return { ok: true, id: result.id };
		},
		settle: () => {
			const { history, openSection, selection } = inner;
			if (pickedOutside(history.present, openSection, selection))
				update({ openSection: null });
		},
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
		selection: inner.selection,
		openSection: inner.openSection,
		madeSection: inner.madeSection,
	};
}

/**
 * `next`, with what it added joined to the open Section `open`: the nodes
 * in no Section, and the new Sections no other Section holds. Unchanged
 * when no Section is open or `next` does not have it.
 */
function joinOpenSection(current: Flow, next: Flow, open: string | null): Flow {
	if (!open || !next.sections?.some((section) => section.id === open))
		return next;
	const before = new Set(current.nodes.map((node) => node.id));
	const added = next.nodes
		.map((node) => node.id)
		.filter((id) => !before.has(id) && !sectionOf(next, id));
	const had = new Set((current.sections ?? []).map((section) => section.id));
	const addedSections = (next.sections ?? [])
		.filter(
			(section) => !had.has(section.id) && !parentSection(next, section.id),
		)
		.map((section) => section.id)
		.filter((id) => id !== open);
	if (added.length === 0 && addedSections.length === 0) return next;
	return updateSection(next, open, (section) => ({
		...section,
		nodes: [...section.nodes, ...added],
		...(addedSections.length > 0 && {
			sections: [...(section.sections ?? []), ...addedSections],
		}),
	}));
}

/**
 * Whether the selection holds something outside the open Section `open`
 * of `flow`: a node it does not hold, or a Section that is not inside it.
 * False when no Section is open or the flow does not have it.
 */
function pickedOutside(
	flow: Flow,
	open: string | null,
	selection: Selection,
): boolean {
	const section = open === null ? undefined : sectionPath(flow, open).at(-1);
	if (!section) return false;
	const inside = (id: string) =>
		sectionPath(flow, id).some((around) => around.id === section.id);
	if (selection?.kind === "section") return !inside(selection.id);
	const members = new Set(nodesWithin(flow, section));
	return (
		selectedNodeIds(selection).some((id) => !members.has(id)) ||
		selectedSectionIds(selection).some((id) => !inside(id))
	);
}
