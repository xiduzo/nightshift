import { DAY_MS } from "@nightshift/time";

/**
 * Device keys: what a paired Device signs in with on a Host. A key is an
 * API key (the API key plugin) of the Person who approved the pairing,
 * with the Device's id as metadata. It is hashed at rest, shown once (to
 * the Device that redeems the pairing), and its permissions are its own,
 * narrower than its Person's: what a Device does as a Device. Who may do
 * what in a Space is still the Person's membership, checked per call.
 *
 * A key expires after `idleDays` without use: every use moves the expiry
 * on (at most once a day, so a busy Device does not write on every call).
 *
 * A Device calls its Host every few seconds, so a Host checks a key itself
 * against its hash, and keeps a valid key in memory for `VERIFIED_MS`.
 * Moving the expiry is the only write. Revoking a key drops it from memory
 * at once. (The plugin's own check writes the key's row on every call.)
 */

/** Every Device key starts with it, so a key is never taken for a session token. */
export const DEVICE_KEY_PREFIX = "nsd_";

/** What a Device key may do: sync (pull, push), relay (serve bodies), archive (put, get). */
export const DEVICE_KEY_PERMISSIONS = {
	sync: ["pull", "push"],
	relay: ["serve"],
	archive: ["put", "get"],
} as const satisfies Record<string, readonly string[]>;

export type DeviceKeyPermission = keyof typeof DEVICE_KEY_PERMISSIONS;

/** How long a key may go unused before it expires, when the Host sets nothing else. */
export const DEFAULT_DEVICE_KEY_IDLE_DAYS = 30;

/** How long a Host keeps a valid key in memory before it reads its row again. */
export const VERIFIED_MS = 60_000;

/** A Device key, resolved: the Device, its owner on this Host, and what it may do. */
export type DeviceKeyAccess = {
	keyId: string;
	deviceId: string;
	/** The Person who approved the pairing: the Device's owner on this Host. */
	personId: string;
	permissions: Record<string, string[]>;
};

/** A key as the Host keeps it, read from its row. */
export type StoredKey = {
	id: string;
	/** The Person the key belongs to. */
	personId: string;
	/** False: the key is turned off. Null counts as on. */
	enabled: boolean | null;
	/** When the key expires (ms), or null for never. */
	expiresAt: number | null;
	permissions: Record<string, string[]>;
	/** The Device in the key's metadata, or null when it names none. */
	deviceId: string | null;
};

/** Whether a token is a Device key, by its prefix. */
export function isDeviceKey(token: string | null | undefined): boolean {
	return typeof token === "string" && token.startsWith(DEVICE_KEY_PREFIX);
}

/** The Device key of an `Authorization: Bearer …` header, else null. */
export function bearerDeviceKey(headers: Headers): string | null {
	const match = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization") ?? "");
	const token = match?.[1] ?? null;
	return isDeviceKey(token) ? token : null;
}

/** Whether a key's permissions hold every action of `need`. */
export function keyAllows(
	permissions: Record<string, string[]>,
	need: DeviceKeyPermission,
): boolean {
	const held = permissions[need] ?? [];
	return DEVICE_KEY_PERMISSIONS[need].every((action) => held.includes(action));
}

/** The permissions a new key gets: every Device permission, as lists. */
export function newKeyPermissions(): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(DEVICE_KEY_PERMISSIONS).map(([k, v]) => [k, [...v]]),
	);
}

/** The name of a new key: the Device's name, cut to 32 characters, else "Device". */
export function keyName(deviceName: string): string {
	return deviceName.slice(0, 32) || "Device";
}

/**
 * The key's new expiry after a use at `now`, when it must move: its idle
 * time from now, at most once a day. Null: the expiry stays.
 */
export function movedExpiry(
	expiresAt: number | null,
	now: number,
	idleMs: number,
): number | null {
	const next = now + idleMs;
	return expiresAt === null || next - expiresAt > DAY_MS ? next : null;
}

/** A valid key as a Host keeps it in memory. */
export type Verified = {
	access: DeviceKeyAccess;
	/** Epoch ms, or null for a key that never expires. */
	expiresAt: number | null;
	/** When this Host read the key's row. */
	checkedAt: number;
};

/** The valid keys this Host checked lately, by their hash: one per Host. */
export type VerifiedKeys = {
	/** The key of that hash while it is fresh at `now`. A stale one is dropped. */
	fresh(hash: string, now: number): Verified | null;
	keep(hash: string, verified: Verified): void;
	drop(hash: string): void;
	/** Drops every key of the Device. */
	dropDevice(deviceId: string): void;
};

export function createVerifiedKeys(): VerifiedKeys {
	const verified = new Map<string, Verified>();
	return {
		fresh(hash, now) {
			const kept = verified.get(hash);
			if (kept && now - kept.checkedAt < VERIFIED_MS) return kept;
			verified.delete(hash);
			return null;
		},
		keep: (hash, found) => {
			verified.set(hash, found);
		},
		drop: (hash) => {
			verified.delete(hash);
		},
		dropDevice(deviceId) {
			for (const [hash, found] of verified) {
				if (found.access.deviceId === deviceId) verified.delete(hash);
			}
		},
	};
}
