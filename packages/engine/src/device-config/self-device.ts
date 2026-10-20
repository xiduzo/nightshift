import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Database } from "@nightshift/db";
import { device } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";

/**
 * This computer's Device: the one `device` row with `self` set. Its id is
 * random and never changes; it is the Walker of every run this computer
 * walks and the Device of its Clones. The migration that added the table
 * made the row for a database that existed before; a database without one
 * gets it here.
 */
export type SelfDevice = { id: string; name: string };

export type SelfDeviceHost = { name: string; platform: string };

/** The host name without the `.local` that macOS adds. */
export function hostDeviceName(name = hostname()): string {
	return name.replace(/\.local$/i, "") || "This computer";
}

const thisHost = (): SelfDeviceHost => ({
	name: hostDeviceName(),
	platform: process.platform,
});

/**
 * This computer's Device, made when there is none. A name or platform the
 * migration left blank is filled in from `host`.
 */
export async function selfDevice(
	db: Database,
	host: SelfDeviceHost = thisHost(),
): Promise<SelfDevice> {
	const [row] = await db.select().from(device).where(eq(device.self, true));
	if (row) {
		if (row.name !== "" && row.platform !== "") {
			return { id: row.id, name: row.name };
		}
		const filled = {
			name: row.name || host.name,
			platform: row.platform || host.platform,
		};
		await db.update(device).set(filled).where(eq(device.id, row.id));
		return { id: row.id, name: filled.name };
	}
	// Two first starts at once: the unique index on `self` keeps one row.
	await db
		.insert(device)
		.values({
			id: randomUUID(),
			name: host.name,
			platform: host.platform,
			self: true,
		})
		.onConflictDoNothing();
	return selfDevice(db, host);
}
