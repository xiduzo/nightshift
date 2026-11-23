import type { Database } from "@nightshift/db";
import { device, runCommand } from "@nightshift/db/schema";
import type { RowBatch } from "@nightshift/engine";
import { asDate, instant, instantOrNull } from "@nightshift/time";
import {
	and,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DeviceStore } from "../../application/ports";
import type { DeviceRow } from "../../domain/paired-device";

type Row = typeof device.$inferSelect;

function toRow(row: Row): DeviceRow {
	return {
		id: row.id,
		name: row.name,
		platform: row.platform,
		homeHost: row.homeHost,
		lastSeenAt: instantOrNull(row.lastSeenAt),
		ownerId: row.ownerId,
		dev: row.dev,
		machine: row.machine,
		self: row.self,
		createdAt: instant(row.createdAt),
		revokedAt: instantOrNull(row.revokedAt),
	};
}

/** The drizzle row of a `DeviceRow`: every column, with its times as dates. */
function fromRow(row: DeviceRow): Row {
	return {
		...row,
		lastSeenAt: row.lastSeenAt === null ? null : asDate(row.lastSeenAt),
		createdAt: asDate(row.createdAt),
		revokedAt: row.revokedAt === null ? null : asDate(row.revokedAt),
	};
}

/** The engine's statements of a batch, as drizzle runs them. */
function itemsOf(rows: RowBatch): BatchItem<"sqlite">[] {
	return rows as unknown as BatchItem<"sqlite">[];
}

/**
 * `DeviceStore` over the `device` table (and the `run_command` rows an
 * adoption renames). `wireRegistry` builds it.
 */
export function drizzleDeviceStore(db: Database): DeviceStore {
	const isSelf = eq(device.self, true);

	async function paired(id: string) {
		const [found] = await db
			.select()
			.from(device)
			.where(and(eq(device.id, id), eq(device.self, false)));
		return found ? toRow(found) : null;
	}

	return {
		async self() {
			const [row] = await db.select().from(device).where(isSelf);
			return row ? toRow(row) : null;
		},
		async selfId() {
			const [row] = await db
				.select({ id: device.id })
				.from(device)
				.where(isSelf);
			return row?.id ?? null;
		},
		async selfOwnerId() {
			const [row] = await db
				.select({ ownerId: device.ownerId })
				.from(device)
				.where(isSelf);
			return row?.ownerId ?? null;
		},
		async addSelf(row) {
			await db
				.insert(device)
				.values({ ...row, self: true })
				.onConflictDoNothing();
		},
		async setFacts(id, facts) {
			await db.update(device).set(facts).where(eq(device.id, id));
		},
		async setOwner(id, personId) {
			await db
				.update(device)
				.set({ ownerId: personId })
				.where(eq(device.id, id));
		},
		async adopt({ row, to, engine }) {
			const from = row.id;
			await db.batch([
				db.update(device).set({ self: false }).where(eq(device.id, from)),
				db
					.insert(device)
					.values({ ...fromRow(row), id: to, self: true })
					.onConflictDoUpdate({ target: device.id, set: { self: true } }),
				...itemsOf(engine),
				db
					.update(runCommand)
					.set({ walkerId: to })
					.where(eq(runCommand.walkerId, from)),
				db.delete(device).where(eq(device.id, from)),
			]);
		},
		paired,
		async pairedOwners() {
			return db
				.select({ id: device.id, ownerId: device.ownerId })
				.from(device)
				.where(eq(device.self, false));
		},
		joinRows(row) {
			const values = {
				name: row.name,
				platform: row.platform,
				ownerId: row.ownerId,
				homeHost: row.homeHost,
				revokedAt: null,
				...(row.machine ? { machine: row.machine } : {}),
			};
			return [
				db
					.insert(device)
					.values({ id: row.id, ...values })
					.onConflictDoUpdate({ target: device.id, set: values }),
			] as unknown as RowBatch;
		},
		async describe(id, facts) {
			await db
				.update(device)
				.set({ name: facts.name, dev: facts.dev, machine: facts.machine })
				.where(eq(device.id, id));
		},
		async sameMachine(ownerId, machine, exceptId) {
			const [found] = await db
				.select()
				.from(device)
				.where(
					and(
						eq(device.ownerId, ownerId),
						eq(device.machine, machine),
						eq(device.self, false),
						eq(device.dev, false),
						ne(device.id, exceptId),
					),
				)
				.orderBy(sql`${device.revokedAt} is not null`, desc(device.lastSeenAt))
				.limit(1);
			return found ? toRow(found) : null;
		},
		async ownedBy(ownerId) {
			const rows = await db
				.select()
				.from(device)
				.where(and(eq(device.ownerId, ownerId), eq(device.self, false)))
				.orderBy(sql`${device.revokedAt} is not null`, desc(device.createdAt));
			return rows.map(toRow);
		},
		async markSeen(id, at) {
			const [updated] = await db
				.update(device)
				.set({ lastSeenAt: asDate(at) })
				.where(and(eq(device.id, id), eq(device.self, false)))
				.returning({ id: device.id, ownerId: device.ownerId });
			return updated ?? null;
		},
		revokeRows(id, at) {
			return [
				db
					.update(device)
					.set({ revokedAt: asDate(at) })
					.where(eq(device.id, id)),
			] as unknown as RowBatch;
		},
		async forget(id, engine) {
			const [first, ...rest] = itemsOf(engine);
			const forgetDevice = db
				.delete(device)
				.where(and(eq(device.id, id), eq(device.self, false)));
			await db.batch(first ? [first, ...rest, forgetDevice] : [forgetDevice]);
		},
		async names(ids) {
			const rows = await db
				.select({ id: device.id, name: device.name })
				.from(device)
				.where(inArray(device.id, [...ids]));
			return new Map(rows.map((d) => [d.id, d.name]));
		},
		async known() {
			return db
				.select({ id: device.id, name: device.name, ownerId: device.ownerId })
				.from(device)
				.where(isNull(device.revokedAt));
		},
		async homePersons() {
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
		},
	};
}
