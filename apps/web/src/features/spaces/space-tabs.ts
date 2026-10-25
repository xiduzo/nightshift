import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

/**
 * The tabs of one browser share one session, so one active Space. A tab
 * that changes it tells the others, and each one loads every query again:
 * its cache still holds the lists of the Space it showed before.
 */

/** The part of a `BroadcastChannel` the tabs use. */
export type TabChannel = Pick<
	BroadcastChannel,
	"postMessage" | "addEventListener" | "removeEventListener"
>;

const CHANNEL = "nightshift-active-space";
const CHANGED = "changed";

/** The tabs of this browser, through `open`'s channel, opened on first use. */
export function createSpaceTabs(open: () => TabChannel | null) {
	let channel: TabChannel | null | undefined;
	const tabs = () => {
		if (channel === undefined) channel = open();
		return channel;
	};
	return {
		/** This tab changed the active Space: it and every other tab load every query again. */
		async changed(queryClient: QueryClient): Promise<void> {
			tabs()?.postMessage(CHANGED);
			await queryClient.invalidateQueries();
		},
		/** Loads every query again when another tab changes the active Space. Returns the stop. */
		follow(queryClient: QueryClient): () => void {
			const channel = tabs();
			if (!channel) return () => {};
			const hear = (event: Event) => {
				if ((event as MessageEvent).data === CHANGED) {
					void queryClient.invalidateQueries();
				}
			};
			channel.addEventListener("message", hear);
			return () => channel.removeEventListener("message", hear);
		},
	};
}

/** This browser's tabs. A page that is built ahead of time opens no channel. */
const spaceTabs = createSpaceTabs(() =>
	typeof BroadcastChannel === "undefined"
		? null
		: new BroadcastChannel(CHANNEL),
);

/** What a page calls once it changed the active Space (a switch, a new Space, a joined one). */
export function useSpaceChanged(): () => Promise<void> {
	const queryClient = useQueryClient();
	return useCallback(() => spaceTabs.changed(queryClient), [queryClient]);
}

/** Follows the active Space that another tab of this browser changes. Mount it once, in the app frame. */
export function SpaceTabs(): null {
	const queryClient = useQueryClient();
	useEffect(() => spaceTabs.follow(queryClient), [queryClient]);
	return null;
}
