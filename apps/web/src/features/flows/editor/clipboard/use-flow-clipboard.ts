// Copy, cut and paste of the selected nodes. The copied nodes stay in this
// tab, so they paste into another flow too.

import {
	copyNodes,
	type Flow,
	type FlowClip,
	pasteNodes,
	removeNode,
} from "@nightshift/flows";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { DraftSetter } from "../history/use-draft-history";
import {
	type Selection,
	type SelectionSetter,
	selectedNodeIds,
} from "../selection";

/** Each paste on the same spot lands this far down and right of the one before. */
const PASTE_STEP = 32;
/** The canvas grid: pasted nodes keep to it. */
const GRID = 8;

let copied: FlowClip | null = null;

/** The nodes a copy takes: the selected nodes, or all nodes of the selected Section. */
function nodesToCopy(flow: Flow, selection: Selection): string[] {
	if (selection?.kind === "section")
		return (
			flow.sections?.find((section) => section.id === selection.id)?.nodes ?? []
		);
	return selectedNodeIds(selection);
}

const snap = (value: number) => Math.round(value / GRID) * GRID;

export function useFlowClipboard({
	draft,
	setDraft,
	selection,
	setSelection,
}: {
	draft: Flow;
	setDraft: DraftSetter;
	selection: Selection;
	setSelection: SelectionSetter;
}) {
	const { screenToFlowPosition } = useReactFlow();
	const store = useStoreApi();

	// Where the pointer is: a paste lands there while it is over the canvas.
	const pointer = useRef<{ x: number; y: number } | null>(null);
	useEffect(() => {
		const onMove = (event: PointerEvent) => {
			pointer.current = { x: event.clientX, y: event.clientY };
		};
		window.addEventListener("pointermove", onMove);
		return () => window.removeEventListener("pointermove", onMove);
	}, []);
	const lastPaste = useRef({ at: "", times: 0 });

	/** Returns false when nothing is selected to copy. */
	const copy = (): boolean => {
		const clip = copyNodes(draft, nodesToCopy(draft, selection));
		if (!clip) return false;
		copied = clip;
		lastPaste.current = { at: "", times: 0 };
		const count = clip.nodes.length;
		toast.success(
			`Copied ${count} ${count === 1 ? "node" : "nodes"}. Press ⌘/Ctrl + V to paste.`,
		);
		return true;
	};

	const cut = (): boolean => {
		const ids = nodesToCopy(draft, selection);
		const clip = copyNodes(draft, ids);
		if (!clip) return false;
		copied = clip;
		lastPaste.current = { at: "", times: 0 };
		setDraft((current) => ids.reduce(removeNode, current));
		setSelection(null);
		return true;
	};

	/** Returns false when nothing was copied yet. */
	const paste = (): boolean => {
		const clip = copied;
		if (!clip) return false;
		const left = Math.min(...clip.nodes.map((node) => node.position.x));
		const top = Math.min(...clip.nodes.map((node) => node.position.y));
		const rect = store.getState().domNode?.getBoundingClientRect();
		const at = pointer.current;
		const over =
			at &&
			rect &&
			at.x >= rect.left &&
			at.x <= rect.right &&
			at.y >= rect.top &&
			at.y <= rect.bottom;
		// Over the canvas: at the pointer. Else just below the copied nodes.
		const anchor = over
			? screenToFlowPosition(at)
			: { x: left + PASTE_STEP, y: top + PASTE_STEP };
		const spot = `${snap(anchor.x)},${snap(anchor.y)}`;
		const times =
			lastPaste.current.at === spot ? lastPaste.current.times + 1 : 0;
		lastPaste.current = { at: spot, times };
		const result = pasteNodes(draft, clip, {
			x: snap(anchor.x - left) + times * PASTE_STEP,
			y: snap(anchor.y - top) + times * PASTE_STEP,
		});
		setDraft(result.flow);
		const [first, ...rest] = result.ids;
		if (first !== undefined)
			setSelection(
				rest.length === 0
					? { kind: "node", id: first }
					: { kind: "nodes", ids: result.ids },
			);
		return true;
	};

	return { copy, cut, paste };
}
