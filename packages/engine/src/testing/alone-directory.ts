import { hostname } from "node:os";
import type { Database } from "@nightshift/db";
import { device } from "@nightshift/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { DeviceDirectory } from "../contract";

/**
 * The Device rows of a computer that is alone (`DeviceDirectory`): its own
 * Device, the names of the Devices a test adds, and no Host. The engine's
 * own tests use it, beside `alonePeers`. The real directory is
 * `deviceDirectory` of `@nightshift/devices`, the owner of the `device`
 * table. A test fixture may read and write that table. The engine does not.
 */
export function aloneDirectory(db: Database): DeviceDirectory {
	return {
		selfId: async () => (await ownDevice(db)).id,
		async selfOwnerId() {
			const [row] = await db
				.select({ ownerId: device.ownerId })
				.from(device)
				.where(eq(device.self, true));
			return row?.ownerId ?? null;
		},
		async names(ids) {
			if (ids.length === 0) return new Map();
			const rows = await db
				.select({ id: device.id, name: device.name })
				.from(device)
				.where(inArray(device.id, [...ids]));
			return new Map(rows.map((d) => [d.id, d.name]));
		},
		hostedElsewhere: async () => false,
	};
}

/**
 * The database's own Device, as a daemon's first start leaves it (`selfDevice`
 * of `@nightshift/devices`): the row the migration made, with the host name
 * and the platform filled in.
 */
export async function ownDevice(
	db: Database,
): Promise<{ id: string; name: string }> {
	const [row] = await db.select().from(device).where(eq(device.self, true));
	if (!row) throw new Error("The test database has no Device of its own.");
	if (row.name !== "" && row.platform !== "") {
		return { id: row.id, name: row.name };
	}
	const filled = {
		name: row.name || hostname().replace(/\.local$/i, "") || "This computer",
		platform: row.platform || process.platform,
	};
	await db.update(device).set(filled).where(eq(device.id, row.id));
	return { id: row.id, name: filled.name };
}
