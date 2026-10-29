import { useMutation } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { type Host, useSignedIn } from "@/features/host";
import { keptStore } from "@/shared/api";
import { usePushPermission } from "./permission";
import { targetKeyOf, withRetry } from "./retry";

/**
 * The EAS project id that Expo's push service knows this app by. Expo
 * gives a push token only with it. Set it once with `eas init` (it writes
 * `expo.extra.eas.projectId` to app.json) or by hand in app.json. Without
 * it, the phone cannot register for notifications: the app works, but
 * the Host sends it nothing.
 */
function projectId(): string | null {
	const extra = Constants.expoConfig?.extra as
		| { eas?: { projectId?: string } }
		| undefined;
	return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/** Whether Expo can give this build a push token: it has an EAS project id. */
export function canGetPushToken(): boolean {
	return projectId() !== null;
}

/** This phone's Expo push token. */
async function pushToken(): Promise<string> {
	const id = projectId();
	if (!id) {
		throw new Error(
			"No EAS project id in app.json (expo.extra.eas.projectId): Expo gives no push token.",
		);
	}
	const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
	return token.data;
}

/**
 * Registers this phone with the Host at every start while someone is
 * signed in and notifications are on. The Host keeps one target per token
 * (it upserts), and forgets a token Expo no longer knows: the next start
 * registers it again. The target id is kept per Host, for "Remove this
 * phone" and for signing out. It tries again while the Host is offline.
 */
export function usePushRegistration(): void {
	const { host } = useSignedIn();
	const permission = usePushPermission();
	const register = useMutation(
		host.orpc.notifications.targets.register.mutationOptions(),
	);
	const { mutateAsync } = register;
	/** A new token from the phone: register again. */
	const [tokenChanges, setTokenChanges] = useState(0);

	useEffect(() => {
		const subscription = Notifications.addPushTokenListener(() =>
			setTokenChanges((n) => n + 1),
		);
		return () => subscription.remove();
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new push token registers again.
	useEffect(() => {
		if (permission !== "on") return;
		const controller = new AbortController();
		void withRetry(
			async () => {
				const endpoint = await pushToken();
				const target = await mutateAsync({
					kind: "expo",
					name: Constants.deviceName ?? "Phone",
					platform: Platform.OS,
					endpoint,
				});
				await keptStore.setItemAsync(targetKeyOf(host.address), target.id);
			},
			{
				signal: controller.signal,
				onError: (error, attempt) => {
					if (__DEV__ && attempt === 0) {
						console.warn("[push] This phone did not register.", error);
					}
				},
			},
		);
		return () => controller.abort();
	}, [permission, host.address, mutateAsync, tokenChanges]);
}

/**
 * Removes this phone's push target at the Host, before the phone signs out
 * or forgets the Host. The Host then sends it nothing more, and ends its
 * session. Offline, the phone signs out anyway.
 */
export async function removeThisPhone(host: Host): Promise<void> {
	const key = targetKeyOf(host.address);
	const id = await keptStore.getItemAsync(key).catch(() => null);
	if (id) {
		await host.client.notifications.targets
			.remove({ id })
			.catch(() => undefined);
	}
	await keptStore.deleteItemAsync(key).catch(() => undefined);
}
