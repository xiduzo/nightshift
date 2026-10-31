import {
	createGateQueries,
	createRunQueries,
	pushDataOf,
	routeOf,
} from "@nightshift/client";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";

import { useHostQueries } from "@/features/host";
import { pushReadsOf } from "./push-data";

/**
 * A read younger than this counts as fresh for a push: a push that came in
 * front and then got its tap reads once.
 */
const JUST_READ_MS = 5_000;

/**
 * A push reads what it opens as it comes, and again on a tap: its run
 * (`runs.get`) and, for a Gate or the inbox, the open Gates (`gates.list`).
 * The screen then opens on data, not on a skeleton. Each read goes to the
 * Host even when the cache holds the data: the push says it changed. The
 * lock screen reads a run it follows the same way (`useLockScreenFollow`).
 * Use it once, behind the sign-in.
 */
export function usePushPrefetch(): void {
	const queryClient = useQueryClient();
	const runQueries = useHostQueries(createRunQueries);
	const gateQueries = useHostQueries(createGateQueries);

	useEffect(() => {
		const read = (notification: Notifications.Notification) => {
			const data = pushDataOf(notification.request.content.data);
			if (!data) return;
			const reads = pushReadsOf(routeOf(data));
			if (reads.runId) {
				void queryClient.prefetchQuery({
					...runQueries.get(reads.runId),
					staleTime: JUST_READ_MS,
				});
			}
			if (reads.gates) {
				void queryClient.prefetchQuery({
					...gateQueries.open(),
					staleTime: JUST_READ_MS,
				});
			}
		};
		const received = Notifications.addNotificationReceivedListener(read);
		const tapped = Notifications.addNotificationResponseReceivedListener(
			(response) => {
				// A button answers in the background: it opens no screen.
				if (
					response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
				) {
					return;
				}
				read(response.notification);
			},
		);
		return () => {
			received.remove();
			tapped.remove();
		};
	}, [queryClient, runQueries, gateQueries]);
}
