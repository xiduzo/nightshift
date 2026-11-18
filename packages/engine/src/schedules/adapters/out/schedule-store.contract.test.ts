import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { project } from "@nightshift/db/schema";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { createFlowDocuments, createProjectFlows } from "../../../flows";
import { PROJECT_NOT_FOUND } from "../../../projects";
import { ownDevice } from "../../../testing/alone-directory";
import { localSpaceId } from "../../../testing/test-support";
import { flowDocumentScheduleStore } from "./flow-document-schedule-store";
import { inMemoryScheduleStore } from "./in-memory-schedule-store";
import { scheduleStoreContract } from "./schedule-store.contract";

/**
 * The contract of `ScheduleStore`, on both adapters. The real side runs
 * on libsql in memory: the flow documents of a migrated database with one
 * project row, and no folder and no git.
 */

const night: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo night",
			stdout: "text",
		},
	],
	edges: [],
};

scheduleStoreContract("in memory", async () => {
	const store = inMemoryScheduleStore();
	store.seed("project-1", { flows: { night: { json: night } } });
	return { store, projectId: "project-1", night, close: async () => {} };
});

scheduleStoreContract("the flow documents, on libsql in memory", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const deviceId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	await db
		.insert(project)
		.values({ id: "project-1", spaceId, name: "one", folder: false });
	const flows = createProjectFlows({
		documents: createFlowDocuments({ db }),
		// What the projects slice answers: the Space, or "not found".
		project: async (projectId) => {
			if (projectId !== "project-1") {
				throw new Refusal("not-found", PROJECT_NOT_FOUND);
			}
			return { spaceId };
		},
		deviceId,
	});
	await flows.save("project-1", "night", night);
	return {
		store: flowDocumentScheduleStore(flows),
		projectId: "project-1",
		night,
		close: async () => {},
	};
});
