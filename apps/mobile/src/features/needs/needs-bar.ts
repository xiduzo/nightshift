import type { OutcomeColor } from "@nightshift/flows";

import type { AnswerBar } from "@/features/inbox";
import { waitsText } from "./queue";

/**
 * The bar above the tabs, without React Native: what the thing on
 * Needs you shows in it, and a small store that the page writes and the
 * bar reads. The bar shows on both tabs, so you can send the answer you
 * chose from anywhere.
 */

/** The thing on screen in Needs you, with where it is in the queue. */
export type NeedsBar = AnswerBar & {
	position: number;
	total: number;
	/** Where it is from: the flow of a Gate, the title of a run. */
	from: string;
};

/** What the bar shows. */
export type AccessoryView = {
	/** "2 of 5 · Daily digest". Null when the page shows nothing yet. */
	caption: string | null;
	/** The option you chose, or what to do: "Choose an answer". */
	label: string;
	/** The flow color of the option you chose. */
	color: OutcomeColor | null;
	/** The bar made small (iOS, while you scroll): only the count. */
	short: string;
	/** The button. Null when you cannot send from the bar. */
	action: { label: string; disabled: boolean } | null;
};

/**
 * What the bar shows for the thing on screen, and how many things wait.
 * No bar when nothing waits and nothing shows.
 */
export function accessoryView(
	bar: NeedsBar | null,
	waiting: number,
): AccessoryView | null {
	const short = waitsText(waiting);
	if (!bar) {
		if (waiting === 0) return null;
		return { caption: null, label: short, color: null, short, action: null };
	}
	const { action } = bar;
	return {
		caption: `${bar.position} of ${bar.total} · ${bar.from}`,
		label: bar.choice?.name ?? bar.prompt,
		color: bar.choice?.color ?? null,
		short,
		action: action
			? {
					label: action.busy ? action.busyLabel : action.label,
					disabled: action.disabled || action.busy,
				}
			: null,
	};
}

/**
 * Holds the bar of the thing on screen and the send that goes with it.
 * The page sets both after each render. Only a change of what the bar
 * shows tells the readers: the send is always the newest one.
 */
export function createBarStore() {
	let bar: NeedsBar | null = null;
	let send: () => void = () => {};
	const listeners = new Set<() => void>();
	return {
		get: (): NeedsBar | null => bar,
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		set(next: NeedsBar | null, onSend: () => void): void {
			send = onSend;
			if (JSON.stringify(next) === JSON.stringify(bar)) return;
			bar = next;
			for (const listener of listeners) listener();
		},
		send(): void {
			send();
		},
	};
}
