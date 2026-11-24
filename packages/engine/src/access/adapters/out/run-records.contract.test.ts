import { expect, test } from "bun:test";
import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { project, run } from "@nightshift/db/schema";
import { applyWalkerMoves, createRunLog, RUN_NOT_FOUND } from "../../../log";
import { appendEvent } from "../../../log/run-log/append";
import { ownDevice } from "../../../testing/alone-directory";
import { localSpaceId, otherSpace } from "../../../testing/test-support";
import { RunNotFound } from "../../domain/refusals";
import { inMemoryRunRecords, runRecord } from "./in-memory-run-records";
import { logRunRecords } from "./log-run-records";
import { runRecordsContract } from "./run-records.contract";

/**
 * The contract of `RunRecords`, on both adapters. The real side runs on
 * libsql in memory: a migrated database with a project in each of two
 * Spaces, and no folder and no git.
 */

runRecordsContract("in memory", async () => {
	const records = inMemoryRunRecords();
	return {
		records,
		spaceId: "space-1",
		otherSpaceId: "space-2",
		add: async ({ id, spaceId }) => records.add(runRecord({ id, spaceId })),
		moveAway: async (runId, to) => records.moveAway(runId, to),
		close: async () => {},
	};
});

runRecordsContract("over the run log, on libsql in memory", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const deviceId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	const otherSpaceId = await otherSpace(db);
	await db.insert(project).values([
		{ id: "project-1", spaceId, name: "one", folder: false },
		{ id: "project-2", spaceId: otherSpaceId, name: "two", folder: false },
	]);
	const log = createRunLog(db, { walkerId: deviceId, dataDir: "/nowhere" });
	return {
		records: logRunRecords(log),
		spaceId,
		otherSpaceId,
		async add({ id, spaceId: space }) {
			await db.insert(run).values({
				id,
				spaceId: space,
				projectId: space === spaceId ? "project-1" : "project-2",
				flow: "{}",
				title: "test",
				worktreePath: "",
				branch: "",
				baseRef: "",
				walkerId: deviceId,
			});
		},
		async moveAway(runId, to) {
			// What a move leaves: its `WalkerMoved`, and the row following it.
			const moved = await appendEvent(
				db,
				{
					runId,
					type: "WalkerMoved",
					payload: { from: deviceId, to, by: null },
				},
				deviceId,
			);
			await applyWalkerMoves(db, [moved]);
		},
		close: async () => {},
	};
});

test("a run that is not found has the words of the run log", () => {
	expect(new RunNotFound().message).toBe(RUN_NOT_FOUND);
});
