import type { Database } from "@nightshift/db";
import { createSpaceArchive, type SpaceArchive } from "../archive";
import { createSyncedDocuments, type SyncedDocuments } from "../documents";
import { createKnowledgeFolders } from "../knowledge/folder";
import { createKnowledge, type KnowledgeDeps } from "../knowledge/knowledge";
import { createKnowledgeDocuments } from "../knowledge/knowledge-document";

/**
 * A computer's knowledge for a test, made as the daemon makes it:
 * `knowledge` for a Device and the API. Beside it, what a test looks at or
 * writes as another computer would: the knowledge documents, the folder of
 * a project and its Space archive (`archive`, a new one unless the test
 * gives the one of its peer engine). `close` ends the Knowledge. Content
 * stays on this computer until the archive is connected to the Hosts.
 */
export function testKnowledge(
	sandbox: { db: Database; dataDir: string; deviceId: string },
	options: Pick<KnowledgeDeps, "meaning" | "pageWaitMs" | "timers"> & {
		archive?: SpaceArchive;
		/** The Replica's synced documents, as its Link syncs them. Default: its own over `db`. */
		synced?: SyncedDocuments;
	} = {},
) {
	const {
		archive = createSpaceArchive(sandbox.dataDir),
		synced = createSyncedDocuments({ db: sandbox.db }),
		...rest
	} = options;
	const knowledge = createKnowledge({
		db: sandbox.db,
		dataDir: sandbox.dataDir,
		documents: synced,
		archive,
		device: { id: sandbox.deviceId, name: "test" },
		...rest,
	});
	return {
		knowledge,
		documents: createKnowledgeDocuments({
			db: sandbox.db,
			documents: synced,
		}),
		archive,
		folder: (projectId: string) =>
			createKnowledgeFolders(sandbox.dataDir).folder(projectId),
		close: () => knowledge.close(),
	};
}
