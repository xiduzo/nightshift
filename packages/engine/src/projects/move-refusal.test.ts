import { expect, test } from "bun:test";
import { project } from "@nightshift/db/schema";
import { createSpaceDocuments } from "../documents";
import { createRunLog } from "../log/run-log/run-log";
import { aloneDirectory } from "../testing/alone-directory";
import { createSandbox, otherSpace } from "../testing/test-support";
import { wireEngineProjects } from "../wire-projects";
import { PROJECT_NOT_FOUND } from "./keep";

/** A project moves from the Space it is in, and to the other one. */
test("refuseMove reads the Space the project leaves and the Space it goes to in that order", async () => {
	const sandbox = await createSandbox();
	const documents = createSpaceDocuments({
		db: sandbox.db,
		directory: aloneDirectory(sandbox.db),
	});
	try {
		const to = await otherSpace(sandbox.db);
		await sandbox.db
			.insert(project)
			.values({ id: "p1", spaceId: sandbox.spaceId, name: "p1" });
		const { projects } = wireEngineProjects({
			db: sandbox.db,
			log: createRunLog(sandbox.db, {
				walkerId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
			}),
			documents,
			directory: aloneDirectory(sandbox.db),
			hosts: undefined,
			options: {},
			access: { openSpace: async () => {} },
			startHolds: () => ({ start: (_spaceId, work) => work() }),
			runner: () => ({ isActive: () => false }),
		});
		await projects.refuseMove("p1", sandbox.spaceId, to);
		await expect(
			projects.refuseMove("p1", to, sandbox.spaceId),
		).rejects.toThrow(PROJECT_NOT_FOUND);
	} finally {
		await documents.flush();
		await sandbox.cleanup();
	}
});
