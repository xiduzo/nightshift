import * as Notifications from "expo-notifications";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { type PushPermission, permissionOf } from "./push-data";

/** The phone's answer, once read. Every card and the registration share it. */
let permission: PushPermission | null = null;
const listeners = new Set<() => void>();

function set(next: PushPermission) {
	if (next === permission) return;
	permission = next;
	for (const listener of listeners) listener();
}

function fromStatus(
	status: Notifications.NotificationPermissionsStatus,
): PushPermission {
	return permissionOf({
		granted: status.granted,
		canAskAgain: status.canAskAgain,
		iosStatus: status.ios?.status,
	});
}

/** Reads the permission again: the person may have changed it in the Settings app. */
async function readPermission(): Promise<void> {
	const status = await Notifications.getPermissionsAsync().catch(() => null);
	if (status) set(fromStatus(status));
}

/** Asks the person. iOS asks once: after a no, only the Settings app can turn it on. */
export async function askPermission(): Promise<PushPermission> {
	const status = await Notifications.requestPermissionsAsync({
		ios: { allowAlert: true, allowBadge: true, allowSound: true },
	});
	const next = fromStatus(status);
	set(next);
	return next;
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Whether this phone may show notifications. Null while the phone answers.
 * It reads again each time the app comes to the front.
 */
export function usePushPermission(): PushPermission | null {
	const value = useSyncExternalStore(subscribe, () => permission);
	useEffect(() => {
		void readPermission();
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") void readPermission();
		});
		return () => subscription.remove();
	}, []);
	return value;
}
