import { project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { FLOW_VERSION } from "@nightshift/flows";
import * as Y from "yjs";
import { createFlowDocuments } from "../../../../documents";
import { localSpaceId } from "../../../../testing/test-support";
import { flowStoreContract } from "./flow-store.contract";
import { inMemoryFlowStore } from "./in-memory-flow-store";
import { yjsFlowStore } from "./yjs-flow-store";

/**
 * The contract of `FlowStore`, on both adapters. The real side runs on
 * libsql in memory: the synced flow documents of a migrated database with
 * two project rows.
 */

flowStoreContract("in memory", async () => {
	const store = inMemoryFlowStore();
	store.seed("project-1");
	store.seed("project-2");
	return {
		store,
		projects: ["project-1", "project-2"],
		putOlder: async (projectId, name) => store.putOlder(projectId, name),
		close: async () => {},
	};
});

flowStoreContract("the flow documents, on libsql in memory", async () => {
	const db = await migratedDb();
	const spaceId = await localSpaceId(db);
	await db.insert(project).values([
		{ id: "project-1", spaceId, name: "one", folder: false },
		{ id: "project-2", spaceId, name: "two", folder: false },
	]);
	const documents = createFlowDocuments({ db });
	return {
		store: yjsFlowStore({ documents }),
		projects: ["project-1", "project-2"],
		async putOlder(projectId, name) {
			const { current } = await documents.open(projectId);
			const flow = [...current.doc.getMap("flows").values()].find(
				(value) => value instanceof Y.Map && value.get("name") === name,
			) as Y.Map<unknown>;
			await current.change(() => flow.set("version", FLOW_VERSION - 1));
		},
		close: () => documents.flush(),
	};
});
