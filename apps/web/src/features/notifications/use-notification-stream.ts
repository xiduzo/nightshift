import { useFollowHost } from "@nightshift/client";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { client, orpc } from "@/shared/api";
import {
	browserName,
	currentSubscription,
	onNotificationClick,
	ownScreenId,
	serviceWorker,
	setOwnScreenId,
	subscriptionParts,
} from "./browser";
import { browserNotifications } from "./browser-notifications";
import { notificationMutations, notificationQueries } from "./queries";

/**
 * Follows what happens in every Space you are in, in place of polling. The
 * live cache of `@nightshift/client` does the work: it reads again what
 * each item changes (the inbox, the tab badge, the runs, the dashboard),
 * shows an item that alerts (a toast while this tab has focus, else a
 * notification of this computer), and closes the notifications of Gates
 * that no longer wait. This page also renews its Web Push subscription and
 * opens the page of a notification you click. Mount it once.
 */
export function useNotificationStream() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const shown = useMemo(
		() => browserNotifications((path) => void router.navigate({ href: path })),
		[router],
	);
	useFollowHost({ client, orpc }, { shown });

	useEffect(() => {
		void serviceWorker().then(() => renewOwnScreen(queryClient));
		return onNotificationClick((path) => void router.navigate({ href: path }));
	}, [queryClient, router]);
}

/** Mounts the notifications stream. Renders nothing. */
export function NotificationStream() {
	useNotificationStream();
	return null;
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
		// The same mutation as the Settings card, run outside a component.
		const screen = await queryClient
			.getMutationCache()
			.build(queryClient, notificationMutations.registerScreen())
			.execute({
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
