import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { project, run } from "@nightshift/db/schema";
import {
	createRunBus,
	createRunLog,
	type EngineEventType,
	type EnginePayloads,
	type LoggedEvent,
} from "../../../../log";
import { appendEvent } from "../../../../log/run-log/append";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import { drizzleOpenWork } from "./drizzle-open-work";
import { inMemoryOpenWork } from "./in-memory-open-work";
import { type EventSpec, openWorkContract } from "./open-work.contract";

/**
 * The contract of `OpenWork`, on both adapters. The real side runs on
 * libsql in memory: a migrated database with one project, the run log of
 * this computer and a run bus. No folder and no git.
 */

/** The Device that walks the runs a test puts elsewhere. */
const FAR = "device-far";

/** The flow of each run: one agent node, the step `s1` of the suite. */
const FLOW = JSON.stringify({
	version: 2,
	start: "a",
	nodes: [{ id: "a", type: "agent", prompt: "work" }],
	edges: [],
});

openWorkContract("in memory", async () => {
	const openWork = inMemoryOpenWork();
	let seq = 0;
	const logged = (runId: string, events: readonly EventSpec[]) =>
		events.map(
			(e) =>
				({
					seq: ++seq,
					runId,
					stepId: e.stepId ?? null,
					sessionId: e.sessionId ?? null,
					type: e.type,
					payload: e.payload,
					at: seq,
				}) as LoggedEvent,
		);
	return {
		openWork,
		async add(runId, events, where) {
			openWork.add(runId, logged(runId, events), {
				...(where === "elsewhere" ? { walkerId: FAR } : {}),
				arriving: where === "arriving",
			});
		},
		letGone: () => openWork.letGone,
		close: async () => {},
	};
});

openWorkContract(
	"over the database and the run log, on libsql in memory",
	async () => {
		const db = createDb({ DATABASE_URL: ":memory:" });
		await migrateDb(db);
		const deviceId = (await ownDevice(db)).id;
		const spaceId = await localSpaceId(db);
		await db
			.insert(project)
			.values({ id: "project-1", spaceId, name: "one", folder: false });
		const log = createRunLog(db, { walkerId: deviceId, dataDir: "/nowhere" });
		const letGone: string[] = [];
		const append = <T extends EngineEventType>(
			runId: string,
			e: EventSpec & { type: T },
			walkerId: string,
		) =>
			appendEvent(
				db,
				{
					runId,
					type: e.type,
					payload: e.payload as EnginePayloads[T],
					stepId: e.stepId ?? null,
					sessionId: e.sessionId ?? null,
				},
				walkerId,
			);
		return {
			openWork: drizzleOpenWork({
				db,
				log,
				bus: createRunBus(),
				// The snapshot as stored. The engine reads it with `parseRunFlow`.
				flowOf: (row) => JSON.parse(row.flow),
				calledFlowsOf: (row) => JSON.parse(row.bodyFlows),
				runHolds: {
					ended: async () => {},
					notContinuing: async (runId) => {
						letGone.push(runId);
					},
					resuming: async () => {},
				},
			}),
			async add(runId, events, where) {
				// A run moved here and not arrived: its row names this computer,
				// and its log ends with the move its old Walker wrote.
				const writer = where === "here" ? deviceId : FAR;
				await db.insert(run).values({
					id: runId,
					spaceId,
					projectId: "project-1",
					flow: FLOW,
					bodyFlows: "{}",
					title: "t",
					worktreePath: "",
					branch: "",
					baseRef: "",
					walkerId: where === "elsewhere" ? FAR : deviceId,
				});
				for (const e of events) await append(runId, e, writer);
				if (where === "arriving") {
					await append(
						runId,
						{
							type: "WalkerMoved",
							payload: { from: FAR, to: deviceId, by: null },
						},
						FAR,
					);
				}
			},
			letGone: () => letGone,
			close: async () => {},
		};
	},
);
