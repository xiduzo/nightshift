import * as SecureStore from "expo-secure-store";

/**
 * The Space the person last chose on this phone, per Host. A new session
 * starts in the personal Space, so the app switches back to this one after
 * a sign-in. A SecureStore key holds only letters, digits, ".", "-" and "_".
 */
function keyOf(address: string): string {
	return `nightshift.space.${address.replace(/[^A-Za-z0-9]/g, "_")}`;
}

export function loadSpaceChoice(address: string): Promise<string | null> {
	return SecureStore.getItemAsync(keyOf(address)).catch(() => null);
}

export function saveSpaceChoice(
	address: string,
	spaceId: string,
): Promise<void> {
	return SecureStore.setItemAsync(keyOf(address), spaceId);
}

export function forgetSpaceChoice(address: string): Promise<void> {
	return SecureStore.deleteItemAsync(keyOf(address));
}
