import { Uniwind, useUniwind } from "uniwind";

import { keptStore } from "@/shared/api";
import { type Appearance, appearanceOf } from "./appearance-choice";

const KEY = "nightshift.appearance";

/**
 * Puts the appearance kept on this phone in place, before the first
 * screen renders. Without one the app follows the phone.
 */
export function applyKeptAppearance(): void {
	let kept: string | null = null;
	try {
		kept = keptStore.getItem(KEY);
	} catch {
		// Nothing to read: follow the phone.
	}
	Uniwind.setTheme(appearanceOf(kept));
}

/**
 * The appearance now, and a change to it. A change applies at once, also
 * to the native headers, sheets and status bar, and stays on this phone.
 */
export function useAppearance(): [Appearance, (next: Appearance) => void] {
	const { theme, hasAdaptiveThemes } = useUniwind();
	const now: Appearance = hasAdaptiveThemes ? "system" : appearanceOf(theme);
	const set = (next: Appearance) => {
		Uniwind.setTheme(next);
		void keptStore.setItemAsync(KEY, next).catch(() => undefined);
	};
	return [now, set];
}
