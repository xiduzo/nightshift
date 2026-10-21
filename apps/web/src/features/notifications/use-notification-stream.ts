import { describeNotice, followNotifications } from "@nightshift/client";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

import { gateQueries } from "@/features/gates";
import { runQueries } from "@/features/runs";
import { client, type NotificationItem } from "@/shared/api";
import {
	browserName,
	closeNotifications,
	currentSubscription,
	onNotificationClick,
	ownScreenId,
	serviceWorker,
	setOwnScreenId,
	showNotification,
	subscriptionParts,
} from "./browser";
import { notificationQueries } from "./queries";

/**
 * Follows what happens in every Space you are in (`notifications.watch`),
 * in place of polling. Each item reads the Gates and the runs again (and
 * with them the inbox, the tab badge and the dashboard). An item with
 * `alert` tells you: a toast while this tab has focus, else a notification
 * of this computer. A closed Gate takes its toast and notification away.
 * After the stream was down, it reads everything again. Mount it once.
 */
export function useNotificationStream() {
	const queryClient = useQueryClient();
	const router = useRouter();

	useEffect(() => {
		const controller = new AbortController();
		const open = (path: string) => void router.navigate({ href: path });
		const refresh = () => {
			void queryClient.invalidateQueries({ queryKey: gateQueries.all() });
			void queryClient.invalidateQueries({ queryKey: runQueries.all() });
		};
		let wasLive = false;

		void serviceWorker().then(() => renewOwnScreen(queryClient));
		const stopClicks = onNotificationClick(open);

		void followNotifications({
			client,
			signal: controller.signal,
			onConnection: (connection) => {
				if (connection !== "live") return;
				// Items of the time it was down are lost: read everything again.
				if (wasLive) refresh();
				wasLive = true;
			},
			onItem: (item) => {
				refresh();
				if (item.kind === "gate-closed") {
					toast.dismiss(item.key);
					void closeNotifications(item.key);
					return;
				}
				if (item.alert) void tell(queryClient, item, open);
			},
		});

		return () => {
			controller.abort();
			stopClicks();
		};
	}, [queryClient, router]);
}

/** Mounts the notifications stream. Renders nothing. */
export function NotificationStream() {
	useNotificationStream();
	return null;
}

type Told = Exclude<NotificationItem, { kind: "gate-closed" }>;

/** Where the item opens in the app. */
function pathOf(item: Told): string {
	if (item.kind === "gate-opened" && item.stepId) {
		return `/inbox?gate=${encodeURIComponent(item.stepId)}`;
	}
	return `/runs/${encodeURIComponent(item.runId)}`;
}

/** The words of the item: the project, run and question when this page can read them. */
async function wordsOf(
	queryClient: QueryClient,
	item: Told,
): Promise<{ title: string; body?: string }> {
	try {
		if (item.kind === "gate-opened") {
			const gates = await queryClient.fetchQuery(gateQueries.open());
			const gate = gates.find(
				(g) => g.runId === item.runId && g.stepId === item.stepId,
			);
			if (gate) {
				return describeNotice({ kind: item.kind, key: item.key, gate });
			}
		} else {
			const runs = await queryClient.fetchQuery(runQueries.everyRun());
			const run = runs.find((r) => r.id === item.runId);
			if (run) return describeNotice({ kind: item.kind, run });
		}
	} catch {
		// The short sentence of the item is enough.
	}
	return { title: item.title };
}

async function tell(
	queryClient: QueryClient,
	item: Told,
	open: (path: string) => void,
): Promise<void> {
	const { title, body } = await wordsOf(queryClient, item);
	const path = pathOf(item);
	const granted =
		typeof Notification !== "undefined" &&
		Notification.permission === "granted";
	if (document.hasFocus() || !granted) {
		toast(title, {
			id: item.key,
			description: body,
			action: { label: "Open", onClick: () => open(path) },
		});
		return;
	}
	await showNotification({
		key: item.key,
		title,
		body,
		path,
		onClick: () => open(path),
	});
}

/**
 * This browser registers its subscription again on each start: the push
 * service may have renewed it, and Night Shift sees the browser is in use.
 * A browser you removed on another screen stops its subscription instead.
 */
async function renewOwnScreen(queryClient: QueryClient): Promise<void> {
	try {
		const own = ownScreenId();
		if (!own || Notification.permission !== "granted") return;
		const subscription = await currentSubscription();
		if (!subscription) return;
		const screens = await queryClient.fetchQuery(notificationQueries.screens());
		if (!screens.some((screen) => screen.id === own)) {
			await subscription.unsubscribe();
			setOwnScreenId(null);
			return;
		}
		const screen = await client.notifications.targets.register({
			kind: "web",
			...browserName(),
			...subscriptionParts(subscription),
		});
		setOwnScreenId(screen.id);
		void queryClient.invalidateQueries({
			queryKey: notificationQueries.all(),
		});
	} catch {
		// It tries again on the next start.
	}
}
