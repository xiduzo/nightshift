import { createQueryClient as createSharedQueryClient } from "@nightshift/client";
import {
	focusManager,
	onlineManager,
	type QueryClient,
} from "@tanstack/react-query";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import { AppState } from "react-native";

import { setPhoneQueryDefaults } from "./query-defaults";

/**
 * The app in front counts as focus: when the person comes back to it, the
 * screens read again what went stale meanwhile.
 */
function followAppState() {
	focusManager.setEventListener((setFocused) => {
		const subscription = AppState.addEventListener("change", (state) => {
			setFocused(state === "active");
		});
		return () => subscription.remove();
	});
}

/**
 * A phone without a network is offline: reads wait instead of failing,
 * and go once the network is back.
 */
function followNetwork() {
	onlineManager.setEventListener((setOnline) => {
		getNetworkStateAsync().then(
			(state) => setOnline(state.isConnected !== false),
			() => undefined,
		);
		const subscription = addNetworkStateListener((state) => {
			setOnline(state.isConnected !== false);
		});
		return () => subscription.remove();
	});
}

/**
 * The query client of the phone: the shared rules, how long each kind of
 * read stays fresh and kept (`setPhoneQueryDefaults`), the app's focus and
 * the network.
 */
export function createQueryClient(): QueryClient {
	followAppState();
	followNetwork();
	const client = createSharedQueryClient();
	setPhoneQueryDefaults(client);
	return client;
}
