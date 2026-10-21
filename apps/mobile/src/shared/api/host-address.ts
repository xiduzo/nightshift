import * as SecureStore from "expo-secure-store";

const KEY = "nightshift.host-address";

/** The Host address this phone connects to, if the person gave one. */
export function loadHostAddress(): Promise<string | null> {
	return SecureStore.getItemAsync(KEY);
}

export function saveHostAddress(address: string): Promise<void> {
	return SecureStore.setItemAsync(KEY, address);
}

export function forgetHostAddress(): Promise<void> {
	return SecureStore.deleteItemAsync(KEY);
}

/**
 * The origin of what the person typed: `nightshift.example.com` becomes
 * `https://nightshift.example.com`. Null when it is no web address.
 */
export function hostAddressOf(input: string): string | null {
	const text = input.trim();
	if (!text) return null;
	const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return url.origin;
	} catch {
		return null;
	}
}
