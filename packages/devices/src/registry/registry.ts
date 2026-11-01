import { personalSpaceIdBySlug } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { device } from "@nightshift/db/schema";
import type { PeerContext } from "@nightshift/engine";
import { deviceDocumentName } from "@nightshift/engine/device-config";
import { Refusal } from "@nightshift/refusal";
import {
	asDate,
	instant,
	instantOrNull,
	now as timeNow,
} from "@nightshift/time";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

/**
 * A paired Device whose Link says nothing for this long is offline: three
 * of its heartbeats, which come every 15 s. The Host's two answers to
 * "is it online?" use the same window: the registry's sweep (`online`,
 * for people) and the work hub's (`online`, for placement).
 */
export const OFFLINE_AFTER_MS = 45_000;

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
 * Host that was down. A `bun --hot` reload is no new start: the registry
 * before hands its presence to the next one (`DevicePresence`).
 */

/**
 * Device id → when its link last answered, for the Devices online now. It
 * outlives a registry: the devices runtime hands it to the next engine's
 * registry on a `bun --hot` reload, so a Device online before the reload
 * is online after it, and nothing is logged.
 */
export type DevicePresence = Map<string, number>;

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
	/**
	 * Its Link answers: a hello or a heartbeat in the last
	 * `OFFLINE_AFTER_MS`. What people see (the Devices page, a Space's
	 * devices, `DeviceOnline` and `DeviceOffline`). Whether it takes the
	 * work of a step now is the work hub's `online`.
	 */
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

/** The names of these Devices (this computer's own too), by id. A Device this Replica has no row of is missing. */
export async function deviceNamesOf(
	db: Database,
	ids: readonly string[],
): Promise<Map<string, string>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: device.id, name: device.name })
		.from(device)
		.where(inArray(device.id, [...ids]));
	return new Map(rows.map((d) => [d.id, d.name]));
}

/**
 * The Persons whose home Host this computer is: each has a paired Device
 * with access that joined it as its home Host. Only a Host has such rows.
 */
export async function homePersonsOf(db: Database): Promise<string[]> {
	const rows = await db
		.selectDistinct({ ownerId: device.ownerId })
		.from(device)
		.where(
			and(
				eq(device.self, false),
				isNotNull(device.homeHost),
				isNull(device.revokedAt),
				isNotNull(device.ownerId),
			),
		);
	return rows.flatMap((row) => (row.ownerId ? [row.ownerId] : []));
}

export function createDeviceRegistry(deps: {
	db: Database;
	/** Logs a Device's facts (`PeerContext.logFact`). */
	logFact: PeerContext["logFact"];
	/** The engine's event log: the latest presence of each Device. */
	history: Pick<PeerContext["history"], "devicePresence">;
	/** The presence of the registry before a reload. Default: every Device offline. */
	presence?: DevicePresence;
	now?: () => number;
}): DeviceRegistry {
	const { db, logFact } = deps;
	const now = deps.now ?? timeNow;
	const online: DevicePresence = deps.presence ?? new Map();

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
			lastSeenAt: instantOrNull(row.lastSeenAt),
			online: online.has(row.id),
			pairedAt: instant(row.createdAt),
			revokedAt: instantOrNull(row.revokedAt),
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
		const found = await personalSpaceIdBySlug(db, ownerId);
		if (found === null) {
			throw new Error("The Device's owner has no personal Space.");
		}
		return found;
	}

	async function logPresence(
		type: "DeviceOnline" | "DeviceOffline",
		deviceRow: { id: string; ownerId: string | null },
	) {
		await logFact({
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
		const last = await deps.history.devicePresence();
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
				throw new Refusal("invalid", "A computer cannot pair with itself.");
			}
			const values = {
				name: input.name,
				platform: input.platform,
				ownerId: input.ownerId,
				homeHost: input.homeHost,
				revokedAt: null,
			};
			// The row and its event are one batch.
			await logFact(
				{
					type: "DeviceJoined",
					payload: {
						deviceId: input.id,
						name: input.name,
						platform: input.platform,
						ownerId: input.ownerId,
						home: input.homeHost !== null,
					},
					spaceId: await spaceOf(input.ownerId),
				},
				{
					before: [
						db
							.insert(device)
							.values({ id: input.id, ...values })
							.onConflictDoUpdate({ target: device.id, set: values }),
					],
				},
			);
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
				.set({ lastSeenAt: asDate(at) })
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
			if (!found) {
				throw new Refusal(
					"not-found",
					"This device is not paired with this computer.",
				);
			}
			if (found.revokedAt) return;
			await logFact(
				{
					type: "DeviceRevoked",
					payload: { deviceId: id },
					spaceId: await spaceOf(found.ownerId ?? ""),
				},
				{
					before: [
						db
							.update(device)
							.set({ revokedAt: asDate(now()) })
							.where(eq(device.id, id)),
					],
				},
			);
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
