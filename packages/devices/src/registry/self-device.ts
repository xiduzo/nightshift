import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { personalSpaceIdBySlug } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import {
	clone,
	device,
	event,
	run,
	runCommand,
	runLease,
	step,
} from "@nightshift/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * This computer's Device: the one `device` row with `self` set. Its id is
 * random. It changes only when the install takes over the Device its home
 * Host knows this computer as (`adoptSelfDevice`). It is the Walker of every
 * run this computer walks and the Device of its Clones. The migration that added the table
 * made the row for a database that existed before; a database without one
 * gets it here.
 */
export type SelfDevice = { id: string; name: string };

export type SelfDeviceHost = {
	name: string;
	platform: string;
	/**
	 * A name an earlier default gave, which `name` now replaces: the host
	 * name before NIGHTSHIFT_DEVICE_NAME was set, or a container id or "Host"
	 * in a container. A name the person chose is never stale.
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
export function inContainer(): boolean {
	return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

/** The host name of the first of NIGHTSHIFT_HOST_ADDRESSES, or null. */
function addressName(addresses: string | undefined): string | null {
	for (const address of (addresses ?? "").split(",")) {
		try {
			const name = new URL(address.trim()).hostname;
			if (name) return name;
		} catch {}
	}
	return null;
}

/**
 * This computer's default Device name and platform: NIGHTSHIFT_DEVICE_NAME
 * when set, else the host name. A container whose host name is its id
 * cannot see the name of its computer: its default is the name in its first
 * Host address, else "Host".
 *
 * A dev daemon (`dev`, NIGHTSHIFT_DEV) runs beside the desktop app on the
 * same computer: its default is "<host name> (dev)", so the two Devices do
 * not share a name (ADR 17). A dev Device still named after the host name
 * takes it too.
 */
export function defaultSelfDeviceHost(
	opts: {
		env?: Record<string, string | undefined>;
		hostName?: string;
		container?: boolean;
		platform?: string;
		dev?: boolean;
	} = {},
): SelfDeviceHost {
	const env = opts.env ?? process.env;
	const raw = hostDeviceName(opts.hostName ?? hostname());
	const container = opts.container ?? inContainer();
	const unnamed = container && isContainerId(raw);
	const chosen = env.NIGHTSHIFT_DEVICE_NAME?.trim();
	const fallback = unnamed
		? addressName(env.NIGHTSHIFT_HOST_ADDRESSES) || "Host"
		: raw;
	const name = chosen || (opts.dev ? `${fallback} (dev)` : fallback);
	return {
		name,
		platform: opts.platform ?? process.platform,
		stale: (current) =>
			current !== name &&
			(current === raw ||
				(container && (isContainerId(current) || current === "Host"))),
	};
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

/**
 * This install becomes the Device its home Host knows this computer as
 * (ADR 20): the `self` row, and every row that names the id it had. The
 * running daemon still holds the old id, so it starts again to use it. A
 * Device document under the old id stays in its row: the Host's copy of the
 * adopted Device is the one that counts.
 *
 * `(walker_id, walker_seq)` is an event's identity everywhere, and a Host
 * drops an event whose identity it knows. So this install's events count
 * on from `lastSeq`, the last the Host has of that Device. A fact at that
 * count holds the place: the next event takes the number after the highest.
 */
export async function adoptSelfDevice(
	db: Database,
	deviceId: string,
	lastSeq = 0,
): Promise<void> {
	const [row] = await db.select().from(device).where(eq(device.self, true));
	if (!row) throw new Error("This computer has no Device row yet.");
	const from = row.id;
	if (from === deviceId) return;
	const spaceId = row.ownerId
		? await personalSpaceIdBySlug(db, row.ownerId)
		: null;
	if (lastSeq > 0 && spaceId === null) {
		throw new Error("This computer has no personal Space yet.");
	}
	await db.batch([
		db.update(device).set({ self: false }).where(eq(device.id, from)),
		db
			.insert(device)
			.values({ ...row, id: deviceId, self: true })
			.onConflictDoUpdate({ target: device.id, set: { self: true } }),
		db.update(clone).set({ deviceId }).where(eq(clone.deviceId, from)),
		db.update(run).set({ walkerId: deviceId }).where(eq(run.walkerId, from)),
		db.update(run).set({ deviceId }).where(eq(run.deviceId, from)),
		db.update(step).set({ deviceId }).where(eq(step.deviceId, from)),
		db
			.update(event)
			.set({
				walkerId: deviceId,
				walkerSeq: sql`${event.walkerSeq} + ${lastSeq}`,
			})
			.where(eq(event.walkerId, from)),
		...(lastSeq > 0 && spaceId !== null
			? [
					db.insert(event).values({
						spaceId,
						type: "DeviceJoined",
						payload: JSON.stringify({
							deviceId,
							name: row.name,
							platform: row.platform,
							ownerId: row.ownerId,
							home: true,
						}),
						walkerId: deviceId,
						walkerSeq: lastSeq,
					}),
				]
			: []),
		db
			.update(runLease)
			.set({ walkerId: deviceId })
			.where(eq(runLease.walkerId, from)),
		db
			.update(runCommand)
			.set({ walkerId: deviceId })
			.where(eq(runCommand.walkerId, from)),
		db.delete(device).where(eq(device.id, from)),
	]);
}
