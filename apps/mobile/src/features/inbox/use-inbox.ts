import {
	createGateQueries,
	followNotifications,
	inboxOrder,
	type OpenGate,
	useLiveCache,
	waitingForYou,
} from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { dismissKey } from "@/features/push";

/** The open Gates of every Space you are in, oldest first. */
export function useInbox() {
	const queries = useHostQueries(createGateQueries);
	return useQuery({
		...queries.open(),
		select: (gates: OpenGate[]) => inboxOrder(gates),
	});
}

/** How many Gates wait for you: the ones you may answer. For the tab badge. */
export function useWaitingCount(): number {
	const queries = useHostQueries(createGateQueries);
	const inbox = useQuery({
		...queries.open(),
		select: (gates: OpenGate[]) => waitingForYou(gates),
	});
	return inbox.data ?? 0;
}

/** Whether the app is in front. */
function useInFront(): boolean {
	const [inFront, setInFront] = useState(AppState.currentState === "active");
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) =>
			setInFront(state === "active"),
		);
		return () => subscription.remove();
	}, []);
	return inFront;
}

/**
 * Keeps the inbox live while the app is in front: it follows the person's
 * notifications, and the live cache reads again what each item changes. A
 * Gate that closes takes its notification away. After a reconnect, or when
 * the app comes back to the front, the cache reads everything again: items
 * of that time are lost. The inbox query polls as a fallback.
 */
export function useLiveInbox(): void {
	const { host } = useSignedIn();
	const live = useLiveCache(host.orpc);
	const inFront = useInFront();

	useEffect(() => {
		if (!inFront) return;
		const controller = new AbortController();
		void followNotifications({
			client: host.client,
			signal: controller.signal,
			onConnection: live.onNotificationsConnection,
			onItem: (item) => {
				live.onNotification(item);
				// Answered somewhere: its notification on this phone goes too.
				if (item.kind === "gate-closed") {
					void dismissKey(item.key).catch(() => undefined);
				}
			},
		});
		return () => controller.abort();
	}, [inFront, host.client, live]);
}
