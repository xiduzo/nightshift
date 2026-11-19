import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { project, run } from "@nightshift/db/schema";
import {
	createRunLog,
	type EngineEventType,
	type EnginePayloads,
	type LoggedEvent,
} from "../../../../log";
import { appendEvent } from "../../../../log/run-log/append";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import { drizzleWaits } from "./drizzle-waits";
import { inMemoryWaits } from "./in-memory-waits";
import { type WaitsUnderTest, waitsContract } from "./waits.contract";

/**
 * The contract of `Waits`, on both adapters. The real side runs on libsql
 * in memory: a migrated database with two projects and the run log of
 * this computer. No folder and no git.
 */

/** The Device that walks the runs a test puts elsewhere. */
const FAR = "device-far";

type Added = Parameters<WaitsUnderTest["add"]>[0];

/** One event of a run's log, as both sides write it. */
type Spec = {
	[T in EngineEventType]: {
		type: T;
		payload: EnginePayloads[T];
		stepId?: string;
	};
}[EngineEventType];

/** The log of an added run: started, its step `s1` started, and then its wait and its wake. */
function logOf(added: Added): Spec[] {
	const events: Spec[] = [
		{
			type: "RunStarted",
			payload: {
				projectId: added.projectId,
				flowName: null,
				title: "t",
				start: "a",
			} as EnginePayloads["RunStarted"],
		},
		{
			type: "StepStarted",
			stepId: "s1",
			payload: {
				nodeId: "a",
				nodeType: "wait",
				visit: 1,
				transcriptPath: "/t/s1",
				logPath: null,
				scope: null,
			},
		},
	];
	if (added.wait) {
		events.push({
			type: "WaitStarted",
			stepId: "s1",
			payload: {
				reason: added.wait.reason,
				until: null,
				message: "It waits.",
				since: 1,
				...(added.wait.signal ? { signal: added.wait.signal } : {}),
			},
		});
	}
	if (added.woke) {
		events.push({
			type: "WaitEnded",
			stepId: "s1",
			payload: {
				early: true,
				...(added.wait?.signal ? { signal: added.wait.signal } : {}),
			},
		});
	}
	return events;
}

waitsContract("in memory", async () => {
	const waits = inMemoryWaits();
	let seq = 0;
	return {
		waits,
		async add(added) {
			waits.add(added.id, {
				projectId: added.projectId,
				...(added.here ? {} : { walkerId: FAR }),
				events: logOf(added).map(
					(e) =>
						({
							seq: ++seq,
							runId: added.id,
							stepId: e.stepId ?? null,
							sessionId: null,
							type: e.type,
							payload: e.payload,
							at: seq,
						}) as LoggedEvent,
				),
			});
		},
		close: async () => {},
	};
});

waitsContract(
	"over the database and the run log, on libsql in memory",
	async () => {
		const db = createDb({ DATABASE_URL: ":memory:" });
		await migrateDb(db);
		const deviceId = (await ownDevice(db)).id;
		const spaceId = await localSpaceId(db);
		await db.insert(project).values([
			{ id: "project-1", spaceId, name: "one", folder: false },
			{ id: "project-2", spaceId, name: "two", folder: false },
		]);
		const log = createRunLog(db, { walkerId: deviceId, dataDir: "/nowhere" });
		return {
			waits: drizzleWaits({ db, log }),
			async add(added) {
				const walkerId = added.here ? deviceId : FAR;
				await db.insert(run).values({
					id: added.id,
					spaceId,
					projectId: added.projectId,
					flow: "{}",
					title: "t",
					worktreePath: "",
					branch: "",
					baseRef: "",
					walkerId,
				});
				for (const e of logOf(added)) {
					await appendEvent(db, { ...e, runId: added.id }, walkerId);
				}
			},
			close: async () => {},
		};
	},
);
