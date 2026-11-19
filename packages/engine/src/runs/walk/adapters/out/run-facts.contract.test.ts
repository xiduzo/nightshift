import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { project, run } from "@nightshift/db/schema";
import type { EnginePayloads } from "../../../../log";
import { createRunBus, createRunLog } from "../../../../log";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import { inMemoryRunFacts } from "./in-memory-run-facts";
import { logRunFacts } from "./log-run-facts";
import { runFactsContract } from "./run-facts.contract";

/**
 * The contract of `RunFacts`, on both adapters. The real side runs on
 * libsql in memory: a migrated database with one run that started, and
 * no folder and no git.
 */

const STARTED = {
	projectId: "project-1",
	flowName: "night",
	title: "night",
	start: "work",
	stopAt: null,
	inputs: {},
} satisfies EnginePayloads["RunStarted"];

runFactsContract("in memory", async () => {
	const facts = inMemoryRunFacts("device-here");
	await facts.append({ runId: "run-1", type: "RunStarted", payload: STARTED });
	return {
		facts,
		runId: "run-1",
		walkerId: "device-here",
		watch: (runId, listener) => facts.watch(runId, listener),
		close: async () => {},
	};
});

runFactsContract(
	"over the run log and the run bus, on libsql in memory",
	async () => {
		const db = createDb({ DATABASE_URL: ":memory:" });
		await migrateDb(db);
		const deviceId = (await ownDevice(db)).id;
		const spaceId = await localSpaceId(db);
		await db
			.insert(project)
			.values({ id: "project-1", spaceId, name: "one", folder: false });
		await db.insert(run).values({
			id: "run-1",
			spaceId,
			projectId: "project-1",
			flow: "{}",
			title: "night",
			worktreePath: "",
			branch: "",
			baseRef: "",
			walkerId: deviceId,
		});
		const log = createRunLog(db, { walkerId: deviceId, dataDir: "/nowhere" });
		await log.append({ runId: "run-1", type: "RunStarted", payload: STARTED });
		const bus = createRunBus();
		return {
			facts: logRunFacts({ log, bus }),
			runId: "run-1",
			walkerId: deviceId,
			watch: (runId, listener) => bus.subscribe(runId, () => listener()),
			close: async () => {},
		};
	},
);
