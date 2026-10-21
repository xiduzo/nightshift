import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import {
	browserName,
	currentSubscription,
	needsHomeScreen,
	ownScreenId,
	pushSupported,
	setOwnScreenId,
	subscribe,
	subscriptionParts,
} from "./browser";
import { notificationMutations, notificationQueries } from "./queries";

/**
 * Whether this browser gets your notifications while no Night Shift page is
 * open:
 * - `home-screen`: an iPhone or iPad can, once Night Shift is on its Home Screen.
 * - `unsupported`: this browser, or this address, cannot.
 * - `denied`: the browser blocks notifications for this site.
 * - `off`, `on`.
 */
export type BrowserPushState =
	| "loading"
	| "home-screen"
	| "unsupported"
	| "denied"
	| "off"
	| "on";

/**
 * Turns notifications in this browser on and off. On: the browser allows
 * them, subscribes with Night Shift's public key, and registers itself as
 * one of your screens. Off: it unsubscribes and leaves your screens.
 */
export function useBrowserPush() {
	const queryClient = useQueryClient();
	const screens = useQuery(notificationQueries.screens());
	const register = useMutation(notificationMutations.registerScreen());
	const remove = useMutation(notificationMutations.removeScreen());
	const [subscribed, setSubscribed] = useState<boolean | null>(null);
	const [permission, setPermission] = useState<
		NotificationPermission | "home-screen" | "unsupported" | null
	>(null);
	const [busy, setBusy] = useState(false);

	const read = useCallback(async () => {
		if (needsHomeScreen()) {
			setPermission("home-screen");
			return;
		}
		if (!pushSupported()) {
			setPermission("unsupported");
			return;
		}
		setPermission(Notification.permission);
		setSubscribed((await currentSubscription()) !== null);
	}, []);

	useEffect(() => {
		void read();
	}, [read]);

	const own = ownScreenId();
	const listed = screens.data?.some((screen) => screen.id === own) ?? false;
	const state: BrowserPushState =
		permission === null ||
		(permission !== "unsupported" &&
			permission !== "home-screen" &&
			subscribed === null)
			? "loading"
			: permission === "unsupported" || permission === "home-screen"
				? permission
				: permission === "denied"
					? "denied"
					: permission === "granted" && subscribed && listed
						? "on"
						: "off";

	const refreshScreens = () =>
		queryClient.invalidateQueries({ queryKey: notificationQueries.all() });

	async function turnOn(): Promise<void> {
		setBusy(true);
		try {
			const allowed = await Notification.requestPermission();
			setPermission(allowed);
			if (allowed !== "granted") return;
			const { publicKey } = await queryClient.fetchQuery(
				notificationQueries.webPushKey(),
			);
			if (!publicKey) {
				throw new Error(
					"This Night Shift cannot send notifications to a browser.",
				);
			}
			const subscription = await subscribe(publicKey);
			const screen = await register.mutateAsync({
				kind: "web",
				...browserName(),
				...subscriptionParts(subscription),
			});
			setOwnScreenId(screen.id);
			setSubscribed(true);
			await refreshScreens();
		} finally {
			setBusy(false);
		}
	}

	async function turnOff(): Promise<void> {
		setBusy(true);
		try {
			await (await currentSubscription())?.unsubscribe();
			setSubscribed(false);
			const id = ownScreenId();
			if (id && listed) await remove.mutateAsync({ id });
			setOwnScreenId(null);
			await refreshScreens();
		} finally {
			setBusy(false);
		}
	}

	return { state, busy, turnOn, turnOff, ownScreenId: listed ? own : null };
}
