import { event, project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { asc, eq } from "drizzle-orm";
import { createRunLog } from "../../log";
import { localSpaceId } from "../../testing/test-support";
import { drizzleRemovalLog } from "./adapters/out/drizzle-removal-log";
import { inMemoryCleanupPorts } from "./adapters/out/in-memory-neighbours";
import type { WorktreeRemoved } from "./domain/safety";

/** The ports of cleanup, the log of removals over a database in memory: where each use-case test starts. */
export async function cleanupPorts() {
	const db = await migratedDb();
	const spaceId = await localSpaceId(db);
	await db
		.insert(project)
		.values(
			["project-1", "project-2"].map((id) => ({ id, spaceId, name: id })),
		);
	const log = createRunLog(db, { walkerId: "here", dataDir: "/nowhere" });
	return {
		...inMemoryCleanupPorts(),
		removalLog: drizzleRemovalLog({ db, log }),
		/** Every removal, oldest first, as it was logged. */
		async removed(): Promise<WorktreeRemoved[]> {
			const rows = await db
				.select({ payload: event.payload })
				.from(event)
				.where(eq(event.type, "WorktreeRemoved"))
				.orderBy(asc(event.seq));
			return rows.map((row) => JSON.parse(row.payload));
		},
		/** Every removal was logged at `at`. */
		removedAt: async (at: number) => {
			await db.update(event).set({ at: asDate(at) });
		},
	};
}
