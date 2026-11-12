import {
	addNode,
	addNodeAfter,
	type Flow,
	type FlowNode,
	NEW_NODE_TAKES,
	type NodeDefaults,
	type Position,
	updateNode,
	type ValuePresetResult,
} from "@nightshift/flows";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaletteItem } from "../../canvas/node-type";
import { freeSpot, useNewNodeSpot } from "../canvas-controls";
import type { DraftSetter } from "../history/use-draft-history";
import type { Selection, SelectionSetter } from "../selection";
import { opensAddNode, trackFocusInput } from "./open-keys";

/** A node's width before React Flow measures it (`w-56`). */
const NODE_WIDTH = 224;
/** The space between a node and the one placed after it. */
const AFTER_GAP = 96;

type Point = { x: number; y: number };

/**
 * The add-node dialog of the editor: Tab, a double-click on the canvas and
 * the dock's first button open it. A node that takes a value goes after
 * the one node selected and reads it (`addNodeAfter`). Every other node
 * lands where the canvas was double-clicked, or in the middle of the view.
 * Each add is one change, through `setDraft`, and selects the new node.
 * While `disabled` (a proposal, a revision or a Subflow on view), nothing
 * opens it.
 */
export function useAddNodeDialog({
	flow,
	setDraft,
	selection,
	setSelection,
	defaults,
	disabled,
}: {
	flow: Flow;
	setDraft: DraftSetter;
	selection: Selection;
	setSelection: SelectionSetter;
	defaults: NodeDefaults | undefined;
	disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	// The point on the screen the canvas was double-clicked at, if it was.
	const anchor = useRef<Point | undefined>(undefined);
	const spot = useNewNodeSpot();
	const { getInternalNode } = useReactFlow();

	const show = useCallback(
		(at?: Point) => {
			if (disabled) return;
			anchor.current = at;
			setOpen(true);
		},
		[disabled],
	);

	// A proposal, a revision or a Subflow that comes on view shuts it.
	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);

	// Tab opens it, where Tab has no other job (`opensAddNode`).
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;
	useEffect(() => {
		const focus = trackFocusInput(window);
		const onKeyDown = (event: KeyboardEvent) => {
			if (disabledRef.current) return;
			if (!opensAddNode(event, focus.history(), document.body)) return;
			event.preventDefault();
			focus.keep();
			anchor.current = undefined;
			setOpen(true);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			focus.stop();
		};
	}, []);

	const from =
		selection?.kind === "node"
			? (flow.nodes.find((node) => node.id === selection.id) ?? null)
			: null;

	/** Right of `node`, level with it. */
	const after = (node: FlowNode): Position => {
		const width = getInternalNode(node.id)?.measured.width ?? NODE_WIDTH;
		return freeSpot(flow, {
			x: node.position.x + width + AFTER_GAP,
			y: node.position.y,
		});
	};

	const place = (item: PaletteItem) =>
		from && NEW_NODE_TAKES[item] === "value"
			? addNodeAfter(flow, item, from.id, after(from), defaults)
			: addNode(flow, item, spot(flow, anchor.current), defaults);

	const commit = ({ flow: next, id }: { flow: Flow; id: string }) => {
		setDraft(() => next);
		setSelection({ kind: "node", id });
	};

	return {
		/** Opens the dialog, to place a node at `at` on the screen, if given. */
		show,
		props: {
			open,
			onOpenChange: setOpen,
			flow,
			from,
			onAddNode: (item: PaletteItem) => commit(place(item)),
			// One Value by rule, with what the preset made, in one change.
			onUsePreset: ({ expression, output }: ValuePresetResult) => {
				const added = place("value");
				commit({
					id: added.id,
					flow: updateNode(added.flow, added.id, (node) =>
						node.type === "value" ? { ...node, expression, output } : node,
					),
				});
			},
		},
	};
}
