// The keys that edit the canvas: undo, redo, copy, cut and paste.

export type EditKey = "undo" | "redo" | "copy" | "cut" | "paste";

/** What each key does. Each returns false when it had nothing to do: the key then does what it does on the page. */
export type EditKeys = Record<EditKey, () => boolean>;

/**
 * The edit a key press asks for: ⌘/Ctrl + Z undoes, ⌘/Ctrl + Shift + Z
 * and ⌘/Ctrl + Y redo, ⌘/Ctrl + C, X and V copy, cut and paste.
 */
export function editKeyOf(
	event: Pick<
		KeyboardEvent,
		"key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
	>,
): EditKey | null {
	if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
	const key = event.key.toLowerCase();
	if (key === "z") return event.shiftKey ? "redo" : "undo";
	if (event.shiftKey) return null;
	if (key === "y") return "redo";
	if (key === "c") return "copy";
	if (key === "x") return "cut";
	if (key === "v") return "paste";
	return null;
}

/**
 * The key belongs to the page: you type in a field, or a dialog has the
 * focus. Copy and cut also leave text you selected on the page alone.
 */
export function leavesKeyToPage(event: KeyboardEvent, edit: EditKey): boolean {
	const target = event.target instanceof Element ? event.target : null;
	if (
		target?.closest(
			"input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog']",
		)
	)
		return true;
	if (edit !== "copy" && edit !== "cut") return false;
	const selected = window.getSelection();
	return selected !== null && !selected.isCollapsed;
}
