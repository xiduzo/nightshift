import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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

export type SelfDeviceHost = {
	name: string;
	platform: string;
	/**
	 * A name an earlier default gave, which `name` now replaces: the host
	 * name before NIGHTSHIFT_DEVICE_NAME was set, or a container id. A name
	 * the person chose is never stale.
	 */
	stale?: (name: string) => boolean;
};

/** The host name without the `.local` that macOS adds. */
export function hostDeviceName(name = hostname()): string {
	return name.replace(/\.local$/i, "") || "This computer";
}

/** The host name Docker gives a container: the first 12 (or all 64) hex digits of its id. */
export function isContainerId(name: string): boolean {
	return /^(?:[0-9a-f]{12}|[0-9a-f]{64})$/.test(name);
}

/** Whether this process runs in a Docker or Podman container. */
function inContainer(): boolean {
	return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

/**
 * This computer's default Device name and platform: NIGHTSHIFT_DEVICE_NAME
 * when set, else the host name. In a container whose host name is its id,
 * the default is "Host".
 */
export function defaultSelfDeviceHost(
	opts: {
		env?: Record<string, string | undefined>;
		hostName?: string;
		container?: boolean;
		platform?: string;
	} = {},
): SelfDeviceHost {
	const env = opts.env ?? process.env;
	const raw = hostDeviceName(opts.hostName ?? hostname());
	const container = opts.container ?? inContainer();
	const name =
		env.NIGHTSHIFT_DEVICE_NAME?.trim() ||
		(container && isContainerId(raw) ? "Host" : raw);
	return {
		name,
		platform: opts.platform ?? process.platform,
		stale: (current) =>
			current !== name &&
			(current === raw || (container && isContainerId(current))),
	};
}

/** This computer's Device id, or null when the database has none yet. It makes nothing. */
export async function selfDeviceId(db: Database): Promise<string | null> {
	const [row] = await db
		.select({ id: device.id })
		.from(device)
		.where(eq(device.self, true));
	return row?.id ?? null;
}

/** The Person who owns this computer's Device, or null before one does. */
export async function selfOwnerId(db: Database): Promise<string | null> {
	const [row] = await db
		.select({ ownerId: device.ownerId })
		.from(device)
		.where(eq(device.self, true));
	return row?.ownerId ?? null;
}

/**
 * Names the Person who owns this computer's Device (`localPerson`). Throws
 * when this computer has no Device row yet.
 */
export async function setSelfOwner(
	db: Database,
	personId: string,
): Promise<void> {
	const [row] = await db
		.select({ id: device.id })
		.from(device)
		.where(eq(device.self, true));
	if (!row) throw new Error("This computer has no Device row yet.");
	await db
		.update(device)
		.set({ ownerId: personId })
		.where(eq(device.id, row.id));
}

/**
 * This computer's Device, made when there is none. A name or platform the
 * migration left blank is filled in from `host`, and so is a stale default
 * name (`SelfDeviceHost.stale`).
 */
export async function selfDevice(
	db: Database,
	host: SelfDeviceHost = defaultSelfDeviceHost(),
): Promise<SelfDevice> {
	const [row] = await db.select().from(device).where(eq(device.self, true));
	if (row) {
		// A default that a newer default replaces: a container id, or the host
		// name from before NIGHTSHIFT_DEVICE_NAME was set.
		if (row.name !== "" && host.stale?.(row.name)) {
			await db
				.update(device)
				.set({ name: host.name })
				.where(eq(device.id, row.id));
			return selfDevice(db, host);
		}
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
