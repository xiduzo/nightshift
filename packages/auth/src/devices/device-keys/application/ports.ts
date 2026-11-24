import type { StoredKey } from "../domain/device-keys";

/**
 * The driven ports of device-keys. The adapters of its own ports sit
 * in `adapters/out/`.
 */

/** The Device keys this Host keeps, as rows. */
export type KeyStore = {
	/** The key of that hash, or null. */
	find(hash: string): Promise<StoredKey | null>;
	/** The ids of every key of the Device. */
	idsOfDevice(deviceId: string): Promise<string[]>;
	/** Deletes the key of that id. */
	remove(keyId: string): Promise<void>;
	/** Deletes the keys of those ids (not empty). */
	removeAll(keyIds: string[]): Promise<void>;
	/** Sets when the key expires. */
	setExpiry(keyId: string, at: number): Promise<void>;
};

/** Makes a Device key through the API key plugin, hashed at rest. */
export type KeyIssuer = {
	/** A new key of the Person, for the Device: the key in the clear, once, and its id. */
	create(key: {
		personId: string;
		name: string;
		deviceId: string;
		permissions: Record<string, string[]>;
		/** Seconds until it expires. */
		expiresIn: number;
	}): Promise<{ key: string; keyId: string }>;
};
