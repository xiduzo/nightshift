import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { organization, project, run } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { drizzleMoveStore } from "./drizzle-move-store";
import { inMemoryMoveStore, moveRecords } from "./in-memory-move-store";
import { moveStoreContract } from "./move-store.contract";

/**
 * The contract of `MoveStore`, on both adapters. The real adapter's side
 * runs on libsql in memory.
 */

moveStoreContract("in memory", async () => {
	const records = moveRecords();
	return {
		moveStore: inMemoryMoveStore(records),
		seed: {
			async space(id) {
				records.spaces.add(id);
			},
			async project(row) {
				records.projects.set(row.id, {
					...row,
					name: row.id,
					folder: true,
					createdAt: asDate(0),
					removedAt: null,
				});
			},
			async run(row) {
				records.runs.push({ ...row });
			},
		},
		close: async () => {},
	};
});

moveStoreContract("over drizzle", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	return {
		moveStore: drizzleMoveStore(db),
		seed: {
			async space(id) {
				await db
					.insert(organization)
					.values({ id, name: id, slug: id, createdAt: asDate(0) });
			},
			async project(row) {
				await db.insert(project).values({ ...row, name: row.id });
			},
			async run(row) {
				await db.insert(run).values({
					...row,
					flow: "{}",
					title: row.id,
					worktreePath: `/w/${row.id}`,
					branch: row.id,
					baseRef: "main",
					startedBy: "ada",
				});
			},
		},
		close: async () => {},
	};
});
