import {
	changesInbox,
	createGateQueries,
	followNotifications,
	inboxOrder,
	type OpenGate,
	waitingForYou,
} from "@nightshift/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";

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
 * notifications and reads the Gates again when one opens or closes. After a
 * reconnect, or when the app comes back to the front, it reads them again
 * too: items of that time are lost. The inbox query polls as a fallback.
 */
export function useLiveInbox(): void {
	const { host } = useSignedIn();
	const queries = useHostQueries(createGateQueries);
	const queryClient = useQueryClient();
	const inFront = useInFront();
	/** The stream was live before: a new `live` may have missed items. */
	const wasLive = useRef(false);

	useEffect(() => {
		if (!inFront) return;
		const controller = new AbortController();
		const refresh = () =>
			void queryClient.invalidateQueries({ queryKey: queries.all() });
		void followNotifications({
			client: host.client,
			signal: controller.signal,
			onConnection: (connection) => {
				if (connection !== "live") return;
				if (wasLive.current) refresh();
				wasLive.current = true;
			},
			onItem: (item) => {
				if (changesInbox(item)) refresh();
			},
		});
		return () => controller.abort();
	}, [inFront, host.client, queries, queryClient]);
}
