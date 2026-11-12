// The key that opens the add-node dialog: Tab, where Tab has no other job.

/** What moved the focus: a click (or a touch), or Tab. */
export type FocusInput = "pointer" | "tab";

/** How the focus got where it is (`trackFocusInput`). */
export type FocusHistory = {
	/** What gave the element with the focus its focus. */
	focusedBy: FocusInput | null;
	/** The last input before this key press. */
	lastInput: FocusInput | null;
};

/** The part of a key press the check reads. */
export type AddNodeKey = {
	key: string;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	defaultPrevented: boolean;
	target: unknown;
};

/** The part of an element the check reads. */
type KeyTarget = { closest(selectors: string): unknown };

/** Where Tab belongs to what has the focus: a field, a dialog, a menu or a list. */
const OWNS_TAB =
	"input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='dialog'], [role='alertdialog'], [role='menu'], [role='menubar'], [role='listbox'], [role='combobox']";
/** The canvas: its empty pane, a node, a Section box or an edge. */
const CANVAS =
	".react-flow__pane, .react-flow__renderer, .react-flow__node, .react-flow__edge";

/**
 * Whether a key press opens the add-node dialog: Tab with no modifier,
 * after a click on the page or on the canvas. The focus is on the page
 * itself, or on a node that a click focused. A node the focus reached with
 * Tab keeps Tab, so a keyboard moves on through the canvas. A keyboard
 * that has not clicked moves on through the page. In a field, a dialog or
 * a menu, Tab does what it always does. `body` is the page.
 */
export function opensAddNode(
	event: AddNodeKey,
	history: FocusHistory,
	body: unknown,
): boolean {
	if (event.key !== "Tab" || event.defaultPrevented) return false;
	if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
		return false;
	const { target } = event;
	if (target === null || target === undefined || target === body)
		return history.lastInput === "pointer";
	if (!isKeyTarget(target) || target.closest(OWNS_TAB)) return false;
	return Boolean(target.closest(CANVAS)) && history.focusedBy === "pointer";
}

function isKeyTarget(target: unknown): target is KeyTarget {
	return (
		typeof target === "object" &&
		target !== null &&
		typeof (target as KeyTarget).closest === "function"
	);
}

/**
 * Follows what moves the focus, for `opensAddNode`. `history()` reads it
 * during a key press. `keep()` says the key press moved nothing: the
 * dialog took it. A dialog that gives the focus back as it closes counts
 * as the input before it. Returns the stop too.
 */
export function trackFocusInput(target: Window): {
	history: () => FocusHistory;
	keep: () => void;
	stop: () => void;
} {
	let last: FocusInput | null = null;
	let beforeKey: FocusInput | null = null;
	let focusedBy: FocusInput | null = null;
	const onPointerDown = () => {
		last = "pointer";
	};
	const onKeyDown = (event: KeyboardEvent) => {
		beforeKey = last;
		if (event.key === "Tab") last = "tab";
	};
	const onFocusIn = () => {
		focusedBy = last;
	};
	target.addEventListener("pointerdown", onPointerDown, true);
	target.addEventListener("keydown", onKeyDown, true);
	target.addEventListener("focusin", onFocusIn, true);
	return {
		history: () => ({ focusedBy, lastInput: beforeKey }),
		keep: () => {
			last = beforeKey;
		},
		stop: () => {
			target.removeEventListener("pointerdown", onPointerDown, true);
			target.removeEventListener("keydown", onKeyDown, true);
			target.removeEventListener("focusin", onFocusIn, true);
		},
	};
}
