import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { project, run, user } from "@nightshift/db/schema";
import { runRecord } from "../../../../access/adapters/out/in-memory-run-records";
import { createRunLog } from "../../../../log";
import { appendEvent } from "../../../../log/run-log/append";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import { inMemoryStarters } from "./in-memory-starters";
import { readStarters } from "./read-starters";
import { startersContract } from "./starters.contract";

/**
 * The contract of `Starters`, on both adapters. The real side runs on
 * libsql in memory: the Persons in `user`, a run's row and its
 * `RunStarted` in the run log.
 */

startersContract("in memory", async () => {
	const starters = inMemoryStarters("Mac mini");
	return {
		starters,
		selfName: "Mac mini",
		async person(id, name, email) {
			if (!email.endsWith(".invalid")) starters.author(id, { name, email });
		},
		started: async (runId, personId) =>
			runRecord({
				id: runId,
				spaceId: "space-1",
				walkerId: "walker",
				startedBy: personId,
			}),
		close: async () => {},
	};
});

startersContract("over the read model, on libsql in memory", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const walkerId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	await db
		.insert(project)
		.values({ id: "project-1", spaceId, name: "one", folder: false });
	const log = createRunLog(db, { walkerId, dataDir: "/nowhere" });
	return {
		starters: readStarters({ db, log, selfName: "Mac mini" }),
		selfName: "Mac mini",
		async person(id, name, email) {
			await db.insert(user).values({ id, name, email, role: "user" });
		},
		async started(runId, personId) {
			const row = runRecord({
				id: runId,
				spaceId,
				walkerId,
				startedBy: personId,
			});
			await db.insert(run).values(row);
			await appendEvent(
				db,
				{
					runId,
					type: "RunStarted",
					payload: {
						projectId: "project-1",
						flowName: null,
						title: "test",
						start: "a",
						startedBy: personId,
					},
				},
				walkerId,
			);
			return row;
		},
		close: async () => {},
	};
});
