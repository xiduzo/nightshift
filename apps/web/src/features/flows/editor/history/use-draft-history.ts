import type { Flow } from "@nightshift/flows";
import { type SetStateAction, useCallback, useState } from "react";
import { record, redo, startHistory, undo } from "./draft-history";

/** How long a pause ends a gesture: typing in one field after it is a new step. */
const GESTURE_PAUSE_MS = 1000;

/**
 * Changes the draft, as `setState` does. With `gesture`, the change merges
 * into the step before while it has the same gesture and came in time.
 */
export type DraftSetter = (
	change: SetStateAction<Flow>,
	gesture?: string,
) => void;

/**
 * The editor's draft with its undo history. `revision` counts the undos
 * and redos: a panel that keeps its own copy of the draft starts again.
 */
export function useDraftHistory(initial: Flow) {
	const [history, setHistory] = useState(() => startHistory(initial));
	const [revision, setRevision] = useState(0);

	const setDraft = useCallback<DraftSetter>((change, gesture) => {
		const merge =
			gesture === undefined
				? undefined
				: { key: gesture, at: Date.now(), within: GESTURE_PAUSE_MS };
		setHistory((current) =>
			record(
				current,
				typeof change === "function" ? change(current.present) : change,
				merge,
			),
		);
	}, []);

	const canUndo = history.past.length > 0;
	const canRedo = history.future.length > 0;
	const undoDraft = useCallback(() => {
		if (!canUndo) return;
		setHistory(undo);
		setRevision((n) => n + 1);
	}, [canUndo]);
	const redoDraft = useCallback(() => {
		if (!canRedo) return;
		setHistory(redo);
		setRevision((n) => n + 1);
	}, [canRedo]);

	return {
		draft: history.present,
		setDraft,
		undo: undoDraft,
		redo: redoDraft,
		canUndo,
		canRedo,
		revision,
	};
}
