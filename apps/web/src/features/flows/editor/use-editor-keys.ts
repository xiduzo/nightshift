// The keys of the whole flow: Cmd+S, the edit keys, Cmd+G, and Escape.

import { useEffect, useRef } from "react";
import { type EditKeys, editKeyOf, leavesKeyToPage } from "./edit-keys";
import type { sectionEdits } from "./sections";
import type { EditingSession } from "./session";
import { selectedNodeIds, selectedSectionIds } from "./session";

/**
 * Cmd+S saves, and Cmd+G makes a Section of what is selected. The edit
 * keys (undo, redo, copy, cut and paste) go to `editKeysRef`: the editor
 * sets it on each render: null while a proposal or a Subflow is on view.
 */
export function useEditorKeys({
	save,
	session,
	sections,
}: {
	save: () => void;
	session: EditingSession;
	sections: ReturnType<typeof sectionEdits>;
}) {
	// The keys that edit the canvas: undo, redo, copy, cut and paste. Not
	// while a proposal or a Subflow is on view.
	const editKeysRef = useRef<EditKeys | null>(null);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const mod = event.metaKey || event.ctrlKey;
			const key = event.key.toLowerCase();
			if (key === "s" && mod) {
				event.preventDefault();
				save();
			}
			const edit = editKeyOf(event);
			const edits = editKeysRef.current;
			if (edit && edits && !leavesKeyToPage(event, edit)) {
				if (edits[edit]()) event.preventDefault();
				return;
			}
			// Cmd/Ctrl+G: make a Section of the selected nodes and boxes.
			if (key === "g" && mod && !event.shiftKey && !event.altKey) {
				const target = event.target as HTMLElement | null;
				if (target?.closest("input, textarea, [contenteditable='true']"))
					return;
				const { selection } = session.get();
				const ids = selectedNodeIds(selection);
				const sectionIds = selectedSectionIds(selection);
				if (ids.length + sectionIds.length === 0) return;
				event.preventDefault();
				sections.makeSection(ids, sectionIds);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [save, session, sections]);
	return { editKeysRef };
}

/** Escape closes the inspector (`closeInspector`) while it is open and no run starts. */
export function useEscapeCloses({
	inspectorOpen,
	starting,
	closeInspector,
}: {
	inspectorOpen: boolean;
	starting: boolean;
	closeInspector: () => void;
}) {
	// Escape closes the inspector, but not while you type in a field or a
	// menu, a list or a dialog has the focus: Escape closes those first.
	useEffect(() => {
		if (!inspectorOpen || starting) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			const target = event.target as HTMLElement | null;
			if (
				target?.closest(
					"input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-slot$='-content']",
				)
			)
				return;
			closeInspector();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [inspectorOpen, starting, closeInspector]);
}
