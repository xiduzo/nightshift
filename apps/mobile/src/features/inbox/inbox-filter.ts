import { useSyncExternalStore } from "react";

import { ALL_GATES, type InboxView } from "./inbox-view";

/**
 * The inbox's place and sort, kept while the app runs: the Inbox tab and
 * its place picker (a sheet, its own route) read and set the same view.
 */
let view: InboxView = ALL_GATES;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function setInboxView(change: Partial<InboxView>): void {
	view = { ...view, ...change };
	for (const listener of listeners) listener();
}

export function useInboxView(): InboxView {
	return useSyncExternalStore(subscribe, () => view);
}
