import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { project, run } from "@nightshift/db/schema";
import type { EnginePayloads } from "../../../log/events/events";
import { appendEvent } from "../../../log/run-log/append";
import { ownDevice } from "../../../testing/alone-directory";
import { localSpaceId } from "../../../testing/test-support";
import { drizzleScheduleLog } from "./drizzle-schedule-log";
import { inMemoryScheduleLog } from "./in-memory-schedule-log";
import { scheduleLogContract } from "./schedule-log.contract";

/**
 * The contract of `ScheduleLog`, on both adapters. The real side runs on
 * libsql in memory: a migrated database with two project rows, and no
 * folder and no git.
 */

scheduleLogContract("in memory", async () => {
	const first = inMemoryScheduleLog();
	return {
		projectId: "project-1",
		otherProjectId: "project-2",
		open: () => inMemoryScheduleLog(first.facts),
		runStarted: async (fact) => first.runStarted(fact),
		close: async () => {},
	};
});

scheduleLogContract("drizzle, on libsql in memory", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const deviceId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	await db.insert(project).values([
		{ id: "project-1", spaceId, name: "one", folder: false },
		{ id: "project-2", spaceId, name: "two", folder: false },
	]);
	const log = {
		append: (input: Parameters<typeof appendEvent>[1]) =>
			appendEvent(db, input, deviceId),
	};
	return {
		projectId: "project-1",
		otherProjectId: "project-2",
		open: () => drizzleScheduleLog({ db, log }),
		async runStarted({ projectId, scheduleId, at, runId }) {
			// What the start of a scheduled run leaves: its row and its `RunStarted`.
			await db.insert(run).values({
				id: runId,
				spaceId,
				projectId,
				flow: "{}",
				title: "night",
				worktreePath: "",
				branch: `nightshift/${runId}`,
				baseRef: "main",
				walkerId: deviceId,
			});
			await appendEvent(
				db,
				{
					runId,
					type: "RunStarted",
					payload: {
						projectId,
						flowName: "night",
						title: "night",
						start: "work",
						stopAt: null,
						inputs: {},
						trigger: { kind: "schedule", scheduleId, at },
					} satisfies EnginePayloads["RunStarted"],
				},
				deviceId,
			);
		},
		close: async () => {},
	};
});
