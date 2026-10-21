import { apiKey } from "@better-auth/api-key";
import type { Database } from "@nightshift/db";
import { apikey } from "@nightshift/db/schema";
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

	async function keyIdsOf(deviceId: string): Promise<string[]> {
		const rows = await db
			.select({ id: apikey.id, metadata: apikey.metadata })
			.from(apikey);
		return rows
			.filter((row) => deviceIdOf(row.metadata) === deviceId)
			.map((row) => row.id);
	}

	async function revoke(deviceId: string): Promise<void> {
		const ids = await keyIdsOf(deviceId);
		if (ids.length > 0) await db.delete(apikey).where(inArray(apikey.id, ids));
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
			const result = await auth.api
				.verifyApiKey({
					body: {
						key,
						...(need
							? { permissions: { [need]: [...DEVICE_KEY_PERMISSIONS[need]] } }
							: {}),
					},
				})
				.catch(() => null);
			const found = result?.valid ? result.key : null;
			if (!found) return null;
			const deviceId = deviceIdOf(found.metadata);
			if (!deviceId) return null;
			// Idle expiry: a use moves the expiry on, at most once a day.
			const expiresAt = found.expiresAt
				? new Date(found.expiresAt).getTime()
				: null;
			const next = Date.now() + idleMs();
			if (expiresAt === null || next - expiresAt > DAY_MS) {
				await db
					.update(apikey)
					.set({ expiresAt: new Date(next) })
					.where(eq(apikey.id, found.id));
			}
			return {
				keyId: found.id,
				deviceId,
				personId: found.referenceId,
				permissions: (found.permissions ?? {}) as Record<string, string[]>,
			};
		},

		revoke,
	};
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
