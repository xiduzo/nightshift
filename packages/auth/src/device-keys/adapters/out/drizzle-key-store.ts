import type { Database } from "@nightshift/db";
import { apikey } from "@nightshift/db/schema";
import { asDate, instantOrNull } from "@nightshift/time";
import { eq, inArray } from "drizzle-orm";
import type { KeyStore } from "../../application/ports";

/** `KeyStore` over the API key plugin's `apikey` table. `wireDeviceKeys` builds it. */
export function drizzleKeyStore(db: Database): KeyStore {
	return {
		async find(hash) {
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
			if (!row) return null;
			return {
				id: row.id,
				personId: row.referenceId,
				enabled: row.enabled,
				expiresAt: instantOrNull(row.expiresAt),
				permissions: permissionsOf(row.permissions),
				deviceId: deviceIdOf(row.metadata),
			};
		},
		async idsOfDevice(deviceId) {
			const rows = await db
				.select({ id: apikey.id, metadata: apikey.metadata })
				.from(apikey);
			return rows
				.filter((row) => deviceIdOf(row.metadata) === deviceId)
				.map((row) => row.id);
		},
		async remove(keyId) {
			await db.delete(apikey).where(eq(apikey.id, keyId));
		},
		async removeAll(keyIds) {
			await db.delete(apikey).where(inArray(apikey.id, keyIds));
		},
		async setExpiry(keyId, at) {
			await db
				.update(apikey)
				.set({ expiresAt: asDate(at) })
				.where(eq(apikey.id, keyId));
		},
	};
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
