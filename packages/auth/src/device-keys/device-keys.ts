import { apiKey, defaultKeyHasher } from "@better-auth/api-key";
import type { Database } from "@nightshift/db";
import { apikey } from "@nightshift/db/schema";
import { asDate, instantOrNull, now } from "@nightshift/time";
import { eq, inArray } from "drizzle-orm";
import type { Auth } from "../auth";

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

/** The API key plugin, as `createAuth` adds it: Device keys are its keys. */
export function deviceKeyPlugin() {
	return apiKey({
		defaultPrefix: DEVICE_KEY_PREFIX,
		enableMetadata: true,
		// A Device calls its Host every few seconds; idle expiry, not a
		// request count, ends a key nobody uses (`createDeviceKeys`).
		rateLimit: { enabled: false },
		keyExpiration: { minExpiresIn: 1, maxExpiresIn: 365 },
	});
}

/** What a Device key may do: sync (pull, push), relay (serve bodies), archive (put, get). */
export const DEVICE_KEY_PERMISSIONS = {
	sync: ["pull", "push"],
	relay: ["serve"],
	archive: ["put", "get"],
} as const satisfies Record<string, readonly string[]>;

export type DeviceKeyPermission = keyof typeof DEVICE_KEY_PERMISSIONS;

/** How long a key may go unused before it expires, when the Host sets nothing else. */
export const DEFAULT_DEVICE_KEY_IDLE_DAYS = 30;

const DAY_MS = 86_400_000;

/** How long a Host keeps a valid key in memory before it reads its row again. */
const VERIFIED_MS = 60_000;

/** A Device key, resolved: the Device, its owner on this Host, and what it may do. */
export type DeviceKeyAccess = {
	keyId: string;
	deviceId: string;
	/** The Person who approved the pairing: the Device's owner on this Host. */
	personId: string;
	permissions: Record<string, string[]>;
};

export type DeviceKeys = {
	/**
	 * A new key for the Device, bound to the Person. The Device's earlier
	 * keys on this Host stop working. The key is returned once and never
	 * stored in the clear.
	 */
	issue(input: {
		personId: string;
		deviceId: string;
		deviceName: string;
	}): Promise<{ key: string; keyId: string }>;
	/**
	 * The key's Device and owner, when the key is valid and allows `need`.
	 * Null for anything else: unknown, expired, revoked, or not a Device key.
	 */
	verify(
		key: string,
		need?: DeviceKeyPermission,
	): Promise<DeviceKeyAccess | null>;
	/** Deletes every key of the Device. Its next call is refused. */
	revoke(deviceId: string): Promise<void>;
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

export function createDeviceKeys(options: {
	auth: Auth;
	db: Database;
	/** How many days a key may go unused. Read on every issue and use. */
	idleDays?: () => number;
}): DeviceKeys {
	const { auth, db } = options;
	const idleMs = () =>
		(options.idleDays?.() ?? DEFAULT_DEVICE_KEY_IDLE_DAYS) * DAY_MS;

	/** The valid keys this Host checked lately, by their hash. */
	const verified = new Map<string, Verified>();

	async function keyIdsOf(deviceId: string): Promise<string[]> {
		const rows = await db
			.select({ id: apikey.id, metadata: apikey.metadata })
			.from(apikey);
		return rows
			.filter((row) => deviceIdOf(row.metadata) === deviceId)
			.map((row) => row.id);
	}

	async function revoke(deviceId: string): Promise<void> {
		for (const [hash, found] of verified) {
			if (found.access.deviceId === deviceId) verified.delete(hash);
		}
		const ids = await keyIdsOf(deviceId);
		if (ids.length > 0) await db.delete(apikey).where(inArray(apikey.id, ids));
	}

	/** The key of that hash, from memory while it is fresh, else from its row. */
	async function lookup(hash: string): Promise<Verified | null> {
		const kept = verified.get(hash);
		if (kept && now() - kept.checkedAt < VERIFIED_MS) return kept;
		verified.delete(hash);
		const [row] = await db
			.select({
				id: apikey.id,
				referenceId: apikey.referenceId,
				enabled: apikey.enabled,
				expiresAt: apikey.expiresAt,
				permissions: apikey.permissions,
				metadata: apikey.metadata,
			})
			.from(apikey)
			.where(eq(apikey.key, hash));
		const deviceId = row ? deviceIdOf(row.metadata) : null;
		if (!row || row.enabled === false || !deviceId) return null;
		const found: Verified = {
			access: {
				keyId: row.id,
				deviceId,
				personId: row.referenceId,
				permissions: permissionsOf(row.permissions),
			},
			expiresAt: instantOrNull(row.expiresAt),
			checkedAt: now(),
		};
		verified.set(hash, found);
		return found;
	}

	return {
		async issue({ personId, deviceId, deviceName }) {
			await revoke(deviceId);
			const created = await auth.api.createApiKey({
				body: {
					userId: personId,
					name: deviceName.slice(0, 32) || "Device",
					metadata: { deviceId },
					permissions: Object.fromEntries(
						Object.entries(DEVICE_KEY_PERMISSIONS).map(([k, v]) => [k, [...v]]),
					),
					expiresIn: Math.round(idleMs() / 1000),
				},
			});
			return { key: created.key, keyId: created.id };
		},

		async verify(key, need) {
			if (!isDeviceKey(key)) return null;
			const hash = await defaultKeyHasher(key);
			const found = await lookup(hash);
			if (!found) return null;
			const { keyId } = found.access;
			if (found.expiresAt !== null && found.expiresAt <= now()) {
				// Past the idle time: refused, and gone, as the plugin does.
				verified.delete(hash);
				await db.delete(apikey).where(eq(apikey.id, keyId));
				return null;
			}
			if (need && !allows(found.access.permissions, need)) return null;
			// Idle expiry: a use moves the expiry on, at most once a day.
			const next = now() + idleMs();
			if (found.expiresAt === null || next - found.expiresAt > DAY_MS) {
				await db
					.update(apikey)
					.set({ expiresAt: asDate(next) })
					.where(eq(apikey.id, keyId));
				found.expiresAt = next;
			}
			return found.access;
		},

		revoke,
	};
}

/** A valid key as a Host keeps it in memory. */
type Verified = {
	access: DeviceKeyAccess;
	/** Epoch ms, or null for a key that never expires. */
	expiresAt: number | null;
	/** When this Host read the key's row. */
	checkedAt: number;
};

/** Whether a key's permissions hold every action of `need`. */
function allows(
	permissions: Record<string, string[]>,
	need: DeviceKeyPermission,
): boolean {
	const held = permissions[need] ?? [];
	return DEVICE_KEY_PERMISSIONS[need].every((action) => held.includes(action));
}

/** A key's permissions: a JSON string in the table. */
function permissionsOf(value: string | null): Record<string, string[]> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, string[]>)
			: {};
	} catch {
		return {};
	}
}

/** The Device id in a key's metadata (a JSON string in the table, an object from the plugin). */
function deviceIdOf(metadata: unknown): string | null {
	let value = metadata;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	const id = (value as { deviceId?: unknown } | null)?.deviceId;
	return typeof id === "string" && id !== "" ? id : null;
}
