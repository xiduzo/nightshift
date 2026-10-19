import type { Database } from "@nightshift/db";
import { organization } from "@nightshift/db/schema/auth";
import { device, event } from "@nightshift/db/schema/nightshift";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { RunLog } from "../run-log";
import { deviceDocumentName } from "./document";

/**
 * The Devices that paired with this Host: their `device` rows, whether they
 * are online, and the audit of it in their owner's personal Space
 * (`DeviceJoined`, `DeviceRevoked`, `DeviceOnline`, `DeviceOffline`).
 *
 * Online is derived, never stored: a Device is online while its link
 * answers (`seen`) and for `offlineAfterMs` after. `last_seen_at` is the
 * fact. A Host that starts again starts with every Device offline: a
 * Device whose last word in the log was `DeviceOnline` gets
 * `DeviceOffline`, so the log never says a Device stayed online across a
 * Host that was down.
 */

export type PairedDevice = {
	id: string;
	name: string;
	platform: string;
	/** The Person who approved the pairing: the Device's owner on this Host. */
	ownerId: string;
	/**
	 * The address the Device joined by, when this Host is its home Host
	 * (it keeps the Device's document). Null: a guest Host.
	 */
	homeHost: string | null;
	/** Epoch ms. Null: never answered after the pairing. */
	lastSeenAt: number | null;
	online: boolean;
	pairedAt: number;
	/** Epoch ms when its owner removed its access. */
	revokedAt: number | null;
};

export type DeviceRegistry = {
	/**
	 * Records a Device that paired with this Host, or paired again: its row
	 * (access back on), and `DeviceJoined`. A Device id that is this Host's
	 * own is refused.
	 */
	join(input: {
		id: string;
		name: string;
		platform: string;
		ownerId: string;
		homeHost: string | null;
	}): Promise<PairedDevice>;
	get(id: string): Promise<PairedDevice | null>;
	/** The Person's paired Devices, revoked ones last. */
	list(ownerId: string): Promise<PairedDevice[]>;
	/** Its link answered: last seen now, and `DeviceOnline` when it was offline. */
	seen(id: string): Promise<void>;
	/** `DeviceOffline` for each Device silent for longer than `offlineAfterMs`. */
	sweep(offlineAfterMs: number): Promise<void>;
	/** Access removed: `DeviceRevoked`, and `DeviceOffline` when it was online. */
	revoke(id: string): Promise<void>;
	/**
	 * The owner of a Device document this Host keeps for a paired Device:
	 * one whose home Host it is, with access. Null for any other name.
	 */
	keptDocumentOwner(documentName: string): Promise<string | null>;
};

export function createDeviceRegistry(deps: {
	db: Database;
	log: RunLog;
	now?: () => number;
}): DeviceRegistry {
	const { db, log } = deps;
	const now = deps.now ?? Date.now;
	/** Device id → when its link last answered, for the Devices online now. */
	const online = new Map<string, number>();

	const ready = closeStalePresence().catch((error) => {
		console.error("Device presence was not tidied up:", error);
	});

	function toPaired(row: typeof device.$inferSelect): PairedDevice {
		return {
			id: row.id,
			name: row.name,
			platform: row.platform,
			ownerId: row.ownerId ?? "",
			homeHost: row.homeHost,
			lastSeenAt: row.lastSeenAt?.getTime() ?? null,
			online: online.has(row.id),
			pairedAt: row.createdAt.getTime(),
			revokedAt: row.revokedAt?.getTime() ?? null,
		};
	}

	async function row(id: string) {
		const [found] = await db
			.select()
			.from(device)
			.where(and(eq(device.id, id), eq(device.self, false)));
		return found ?? null;
	}

	/** The personal Space of the Person: where their Devices' facts are logged. */
	async function spaceOf(ownerId: string): Promise<string> {
		const [found] = await db
			.select({ id: organization.id })
			.from(organization)
			.where(eq(organization.slug, `personal-${ownerId}`));
		if (!found) throw new Error("The Device's owner has no personal Space.");
		return found.id;
	}

	async function logPresence(
		type: "DeviceOnline" | "DeviceOffline",
		deviceRow: { id: string; ownerId: string | null },
	) {
		await log.append({
			type,
			payload: { deviceId: deviceRow.id },
			spaceId: await spaceOf(deviceRow.ownerId ?? ""),
		});
	}

	async function closeStalePresence() {
		const rows = await db
			.select({ id: device.id, ownerId: device.ownerId })
			.from(device)
			.where(eq(device.self, false));
		if (rows.length === 0) return;
		const presence = await db
			.select({
				deviceId: sql<string>`json_extract(${event.payload}, '$.deviceId')`,
				type: event.type,
			})
			.from(event)
			.where(inArray(event.type, ["DeviceOnline", "DeviceOffline"]))
			.orderBy(asc(event.seq));
		const last = new Map(presence.map((p) => [p.deviceId, p.type]));
		for (const r of rows) {
			if (last.get(r.id) === "DeviceOnline" && !online.has(r.id)) {
				await logPresence("DeviceOffline", r);
			}
		}
	}

	return {
		async join(input) {
			await ready;
			const [self] = await db
				.select({ id: device.id })
				.from(device)
				.where(eq(device.self, true));
			if (self?.id === input.id) {
				throw new Error("A computer cannot pair with itself.");
			}
			const values = {
				name: input.name,
				platform: input.platform,
				ownerId: input.ownerId,
				homeHost: input.homeHost,
				revokedAt: null,
			};
			await db
				.insert(device)
				.values({ id: input.id, ...values })
				.onConflictDoUpdate({ target: device.id, set: values });
			await log.append({
				type: "DeviceJoined",
				payload: {
					deviceId: input.id,
					name: input.name,
					platform: input.platform,
					ownerId: input.ownerId,
					home: input.homeHost !== null,
				},
				spaceId: await spaceOf(input.ownerId),
			});
			const joined = await row(input.id);
			if (!joined) throw new Error("The Device was not recorded.");
			return toPaired(joined);
		},

		async get(id) {
			const found = await row(id);
			return found ? toPaired(found) : null;
		},

		async list(ownerId) {
			const rows = await db
				.select()
				.from(device)
				.where(and(eq(device.ownerId, ownerId), eq(device.self, false)))
				.orderBy(sql`${device.revokedAt} is not null`, desc(device.createdAt));
			return rows.map(toPaired);
		},

		async seen(id) {
			await ready;
			const at = now();
			const wasOnline = online.has(id);
			online.set(id, at);
			const [updated] = await db
				.update(device)
				.set({ lastSeenAt: new Date(at) })
				.where(and(eq(device.id, id), eq(device.self, false)))
				.returning({ id: device.id, ownerId: device.ownerId });
			if (!updated) {
				online.delete(id);
				return;
			}
			if (!wasOnline) await logPresence("DeviceOnline", updated);
		},

		async sweep(offlineAfterMs) {
			await ready;
			const cutoff = now() - offlineAfterMs;
			for (const [id, at] of [...online]) {
				if (at > cutoff) continue;
				online.delete(id);
				const found = await row(id);
				if (found) await logPresence("DeviceOffline", found);
			}
		},

		async revoke(id) {
			await ready;
			const found = await row(id);
			if (!found)
				throw new Error("This device is not paired with this computer.");
			if (found.revokedAt) return;
			await db
				.update(device)
				.set({ revokedAt: new Date(now()) })
				.where(eq(device.id, id));
			await log.append({
				type: "DeviceRevoked",
				payload: { deviceId: id },
				spaceId: await spaceOf(found.ownerId ?? ""),
			});
			if (online.delete(id)) await logPresence("DeviceOffline", found);
		},

		async keptDocumentOwner(documentName) {
			const prefix = deviceDocumentName("");
			if (!documentName.startsWith(prefix)) return null;
			const found = await row(documentName.slice(prefix.length));
			if (!found || found.revokedAt || found.homeHost === null) return null;
			return found.ownerId;
		},
	};
}
