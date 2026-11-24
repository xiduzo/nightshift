import type { Database } from "@nightshift/db";
import { device } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import type { RowBatch } from "@nightshift/engine";
import { asDate } from "@nightshift/time";
import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzleDeviceStore } from "./adapters/out/drizzle-device-store";
import {
	inMemoryDeviceFacts,
	inMemoryDeviceHistory,
	inMemoryEngineDeviceRows,
	inMemoryPersonalSpaces,
	inMemoryThisComputer,
} from "./adapters/out/in-memory-neighbours";
import type { DevicePresence, DeviceRow } from "./domain/paired-device";

/** An empty Replica: a database in memory without the row of this computer that the migrations make. */
export async function emptyReplica(): Promise<Database> {
	const db = await migratedDb();
	await db.delete(device);
	return db;
}

/** Runs a batch of the store's statements, as the engine's log runs `before`. */
export async function runBatch(db: Database, batch: RowBatch): Promise<void> {
	const [first, ...rest] = batch as unknown as BatchItem<"sqlite">[];
	if (first) await db.batch([first, ...rest]);
}

const date = (at: number | null | undefined) =>
	at === null || at === undefined ? null : asDate(at);

/** Every port of the registry: the store over an empty Replica, the others in memory. Where each use-case test starts. */
export async function registryPorts() {
	const db = await emptyReplica();
	// What the engine's statements of a batch named, in the order they ran.
	await db.run(sql`create table engine_ran (what text not null)`);
	let clock = 1_000_000;
	let ids = 0;
	const now = () => clock;
	return {
		store: drizzleDeviceStore(db),
		/** Adds a row, as another start or a pairing left it: what it does not name is the default of a new row. */
		async add(row: Partial<DeviceRow> & { id: string }) {
			const values = {
				platform: "linux",
				...row,
				name: row.name ?? row.id,
				createdAt: asDate(row.createdAt ?? now()),
				lastSeenAt: date(row.lastSeenAt),
				revokedAt: date(row.revokedAt),
			};
			await db
				.insert(device)
				.values(values)
				.onConflictDoUpdate({ target: device.id, set: values });
		},
		/** Takes a row away. */
		remove: async (id: string) => {
			await db.delete(device).where(eq(device.id, id));
		},
		/** The ids of every row. */
		rowIds: async () =>
			(await db.select({ id: device.id }).from(device)).map((row) => row.id),
		facts: inMemoryDeviceFacts((batch) => runBatch(db, batch)),
		history: inMemoryDeviceHistory(),
		engineRows: inMemoryEngineDeviceRows(
			(what) =>
				[
					db.run(sql`insert into engine_ran values (${what})`),
				] as unknown as RowBatch,
		),
		/** What the engine's statements named, in the order they ran. */
		engineRan: async () =>
			(
				await db.all<{ what: string }>(
					sql`select what from engine_ran order by rowid`,
				)
			).map((row) => row.what),
		spaces: inMemoryPersonalSpaces(),
		computer: inMemoryThisComputer(),
		online: new Map() as DevicePresence,
		documentPrefix: "device:",
		newId: () => `id-${++ids}`,
		now,
		/** Moves the clock of the test on. */
		later(ms: number) {
			clock += ms;
		},
	};
}
