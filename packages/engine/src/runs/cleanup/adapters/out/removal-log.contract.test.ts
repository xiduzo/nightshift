import { project } from "@nightshift/db/schema";
import { createRunLog } from "../../../../log";
import { createSandbox } from "../../../testing";
import { drizzleRemovalLog } from "./drizzle-removal-log";
import { inMemoryRemovalLog } from "./in-memory-removal-log";
import { removalLogContract } from "./removal-log.contract";

/**
 * The contract of `RemovalLog`, on both adapters. The real side runs on a
 * sandbox's database with two projects, and appends through the run log
 * as the cleanup does.
 */

removalLogContract("in memory", async () => ({
	removalLog: inMemoryRemovalLog(),
	close: async () => {},
}));

removalLogContract("over drizzle, on a sandbox", async () => {
	const sandbox = await createSandbox();
	for (const id of ["p1", "p2"]) {
		await sandbox.db
			.insert(project)
			.values({ id, spaceId: sandbox.spaceId, name: id });
	}
	const log = createRunLog(sandbox.db, {
		walkerId: sandbox.deviceId,
		dataDir: sandbox.dataDir,
	});
	return {
		removalLog: drizzleRemovalLog({ db: sandbox.db, log }),
		close: () => sandbox.cleanup(),
	};
});
