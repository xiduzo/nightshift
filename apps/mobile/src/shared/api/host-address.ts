import { keptStore } from "./kept-store";

const KEY = "nightshift.host-address";

/** The Host address this phone connects to, if the person gave one. */
export function loadHostAddress(): Promise<string | null> {
	return keptStore.getItemAsync(KEY);
}

export function saveHostAddress(address: string): Promise<void> {
	return keptStore.setItemAsync(KEY, address);
}

export function forgetHostAddress(): Promise<void> {
	return keptStore.deleteItemAsync(KEY);
}
