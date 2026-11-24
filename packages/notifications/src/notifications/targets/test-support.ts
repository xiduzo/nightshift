import { pushTarget } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { sql } from "drizzle-orm";
import { drizzleTargetStore } from "./adapters/out/drizzle-target-store";
import { inMemorySessions } from "./adapters/out/in-memory-neighbours";

/** Every port of targets: the store over a database in memory, the sessions in memory. Where each use-case test starts. */
export async function targetsPorts() {
	const db = await migratedDb();
	const targetStore = drizzleTargetStore(db);
	let ids = 0;
	const ports = {
		targetStore,
		/** Every target of every Person, in the order they were added. */
		async allTargets() {
			const rows = await db
				.select({ id: pushTarget.id })
				.from(pushTarget)
				.orderBy(sql`rowid`);
			const kept = await targetStore.byIds(rows.map((row) => row.id));
			return rows.flatMap((row) => kept.filter((t) => t.id === row.id));
		},
		sessions: inMemorySessions(),
		/** The time of the test, in ms. A test sets it. */
		time: 1_000,
		clock: () => ports.time,
		newId: () => `target-${++ids}`,
	};
	return ports;
}
