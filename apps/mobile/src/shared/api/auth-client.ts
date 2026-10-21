import { expoClient } from "@better-auth/expo/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

/** The app's scheme in app.json. The Host trusts it for sign-in. */
const SCHEME = "nightshift";

/**
 * Where the session cookie of one Host is kept. Each Host gets its own
 * keys, so a cookie never goes to another Host. A SecureStore key holds
 * only letters, digits, ".", "-" and "_".
 */
function storagePrefixOf(address: string): string {
	return `${SCHEME}_${address.replace(/[^A-Za-z0-9]/g, "_")}`;
}

/**
 * Better Auth for one Host. The expo plugin keeps the session cookie in
 * SecureStore and sends the app's scheme as its origin. The sign-in form
 * asks for the two-factor code itself (`twoFactorRedirect`).
 */
export function createHostAuthClient(address: string) {
	return createAuthClient({
		baseURL: address,
		plugins: [
			expoClient({
				scheme: SCHEME,
				storagePrefix: storagePrefixOf(address),
				storage: SecureStore,
			}),
			twoFactorClient(),
		],
	});
}

export type HostAuthClient = ReturnType<typeof createHostAuthClient>;
