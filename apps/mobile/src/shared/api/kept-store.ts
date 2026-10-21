import * as SecureStore from "expo-secure-store";

/**
 * SecureStore, readable while the phone is locked (after its first unlock
 * since a restart). The answer to a lock-screen Gate goes from a locked
 * phone: it needs the Host address and the session cookie then. The
 * default (`WHEN_UNLOCKED`) would hide them. A write moves an item that
 * was kept with the default to this setting.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
	keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/**
 * One object for every Host: the Better Auth Expo client coordinates its
 * reads and writes through the storage object it gets.
 */
export const keptStore = {
	getItem: (key: string) => SecureStore.getItem(key, OPTIONS),
	getItemAsync: (key: string) => SecureStore.getItemAsync(key, OPTIONS),
	setItem: (key: string, value: string) =>
		SecureStore.setItem(key, value, OPTIONS),
	setItemAsync: (key: string, value: string) =>
		SecureStore.setItemAsync(key, value, OPTIONS),
	deleteItemAsync: (key: string) => SecureStore.deleteItemAsync(key, OPTIONS),
};
