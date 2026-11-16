// A catalog entry on its way to the canvas: from the node dock or the grid.

import type { CatalogEntry } from "./catalog";

/** The drag data of an entry: its catalog key (`CatalogEntry.key`). */
export const NODE_DRAG_TYPE = "application/x-nightshift-node";

/**
 * Makes an element drag `entry` onto the canvas. `onDragChange` gets the
 * entry, and null when the drag ends. `onEnd` hears whether the canvas
 * took the drop.
 */
export function dragEntry(
	entry: CatalogEntry,
	onDragChange: (entry: CatalogEntry | null) => void,
	onEnd?: (dropped: boolean) => void,
) {
	return {
		draggable: true,
		onDragStart: (event: React.DragEvent) => {
			event.dataTransfer.setData(NODE_DRAG_TYPE, entry.key);
			event.dataTransfer.effectAllowed = "move";
			onDragChange(entry);
		},
		onDragEnd: (event: React.DragEvent) => {
			onDragChange(null);
			onEnd?.(event.dataTransfer.dropEffect !== "none");
		},
	};
}
