import { project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { createRunLog } from "../../../../log";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import { inMemoryNewRuns } from "./in-memory-new-runs";
import { logNewRuns } from "./log-new-runs";
import { newRunsContract } from "./new-runs.contract";

/**
 * The contract of `NewRuns`, on both adapters. The real side runs on
 * libsql in memory: a migrated database with one project, and the run
 * log over it.
 */

newRunsContract("in memory", async () => {
	const runs = inMemoryNewRuns();
	return {
		runs,
		spaceId: "space-1",
		events: async (runId) =>
			runs.events(runId).map(({ type, payload }) => ({ type, payload })),
		close: async () => {},
	};
});

newRunsContract("over the run log, on libsql in memory", async () => {
	const db = await migratedDb();
	const walkerId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	await db
		.insert(project)
		.values({ id: "project-1", spaceId, name: "one", folder: false });
	const log = createRunLog(db, { walkerId, dataDir: "/nowhere" });
	return {
		runs: logNewRuns({ db, log }),
		spaceId,
		events: async (runId) =>
			(await log.events(runId)).map(({ type, payload }) => ({ type, payload })),
		close: async () => {},
	};
});
