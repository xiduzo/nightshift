import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { project, run } from "@nightshift/db/schema";
import { asDate, now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { runRecord } from "../../../../access/adapters/out/in-memory-run-records";
import { createRunBus, createRunLog, getRunRow } from "../../../../log";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import { drizzleRunViews } from "./drizzle-run-views";
import { inMemoryRunViews, THIS_COMPUTER } from "./in-memory-run-views";
import { runViewsContract } from "./run-views.contract";

/**
 * The contract of `RunViews`, on both adapters. The real side runs on
 * libsql in memory: a migrated database, the run log and the bus over
 * it, and no folder and no git.
 */

runViewsContract("in memory", async (neighbours) => {
	const views = inMemoryRunViews(neighbours, THIS_COMPUTER);
	const spaceId = "space-1";
	return {
		views,
		spaceId,
		addProject: async (id) => views.project(id),
		async addRun({ id, createdAt, ...columns }) {
			views.add(
				runRecord({
					id,
					spaceId,
					projectId: "p",
					title: id,
					createdAt: asDate(createdAt ?? now()),
					...columns,
				}),
			);
		},
		startedAt: async (runId, at) =>
			views.change(runId, { createdAt: asDate(at) }),
		append: async (event) => {
			views.append(event);
		},
		async row(runId) {
			const row = views.row(runId);
			if (!row) throw new Error(`No run ${runId}.`);
			return row;
		},
		close: async () => {},
	};
});

runViewsContract(
	"over the database and the run log, on libsql in memory",
	async (neighbours) => {
		const db = createDb({ DATABASE_URL: ":memory:" });
		await migrateDb(db);
		const deviceId = (await ownDevice(db)).id;
		const spaceId = await localSpaceId(db);
		const log = createRunLog(db, { walkerId: deviceId, dataDir: "/nowhere" });
		return {
			views: drizzleRunViews({
				db,
				log,
				bus: createRunBus(),
				deviceId,
				...neighbours,
			}),
			spaceId,
			async addProject(id) {
				await db.insert(project).values({ id, spaceId, name: id });
			},
			async addRun({ id, createdAt, ...columns }) {
				await db.insert(run).values({
					id,
					spaceId,
					projectId: "p",
					flow: "{}",
					title: id,
					worktreePath: "",
					branch: "",
					baseRef: "",
					walkerId: deviceId,
					createdAt: asDate(createdAt ?? now()),
					...columns,
				});
			},
			async startedAt(runId, at) {
				await db
					.update(run)
					.set({ createdAt: asDate(at) })
					.where(eq(run.id, runId));
			},
			async append(event) {
				await log.append(event);
			},
			row: (runId) => getRunRow(db, runId),
			close: async () => {},
		};
	},
);
