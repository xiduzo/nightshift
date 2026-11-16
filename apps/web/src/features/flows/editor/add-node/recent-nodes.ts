// The nodes a person added last, for the node dock. This browser keeps
// them: a convenience, never shared, so a lost list starts over.

import { useState } from "react";
import type { PaletteItem } from "../../canvas/node-type";
import { isPaletteItem } from "./catalog";

/** The most the dock keeps, and shows when the screen has room. */
export const RECENT_MAX = 8;

/** What the dock shows before a person adds a node. */
export const RECENT_START: readonly PaletteItem[] = [
	"agent",
	"command",
	"gate",
	"branch",
	"value",
];

const STORAGE_KEY = "nightshift:recent-nodes";

/** The list with `item` first, once, and at most `RECENT_MAX` long. */
export function withRecent(
	list: readonly PaletteItem[],
	item: PaletteItem,
): PaletteItem[] {
	return [item, ...list.filter((other) => other !== item)].slice(0, RECENT_MAX);
}

/**
 * The list a browser kept: only the node types that still exist, each
 * once. Nothing kept, or nothing valid, gives `RECENT_START`.
 */
export function readRecent(raw: string | null): PaletteItem[] {
	try {
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (!Array.isArray(parsed)) return [...RECENT_START];
		const items = [...new Set(parsed.filter(isPaletteItem))];
		return items.length > 0 ? items.slice(0, RECENT_MAX) : [...RECENT_START];
	} catch {
		return [...RECENT_START];
	}
}

/** The recent nodes of this browser, and how to add one to the front. */
export function useRecentNodes() {
	const [items, setItems] = useState<PaletteItem[]>(() => {
		try {
			return readRecent(localStorage.getItem(STORAGE_KEY));
		} catch {
			return [...RECENT_START];
		}
	});
	const remember = (item: PaletteItem) => {
		setItems((list) => {
			const next = withRecent(list, item);
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {
				// A browser that keeps nothing still has the list until a reload.
			}
			return next;
		});
	};
	return { items, remember };
}
