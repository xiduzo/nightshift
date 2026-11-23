import type { Database } from "@nightshift/db";
import { createSpaceArchive, type SpaceArchive } from "../archive";
import {
	createSyncedDocuments,
	documentName,
	type SyncedDocuments,
} from "../documents";
import { wireKnowledge } from "../knowledge";
import { fsKnowledgeFolders } from "../knowledge/files/adapters/out/fs-knowledge-folders";
import {
	createKnowledgeFolderLocks,
	type KnowledgeFolderLocks,
} from "../knowledge/sync";
import { yjsKnowledgeDocuments } from "../knowledge/sync/adapters/out/yjs-knowledge-documents";

type KnowledgeDeps = Parameters<typeof wireKnowledge>[0];

/**
 * A computer's knowledge for a test, made as the daemon makes it:
 * `knowledge` for a Device and the API. Beside it, what a test looks at or
 * writes as another computer would: the knowledge documents (`documents`, and
 * `persisted` to sync one as a Link does), the folder of a project and its
 * Space archive (`archive`, a new one unless the test
 * gives the one of its peer engine). `close` ends the Knowledge. Content
 * stays on this computer until the archive is connected to the Hosts.
 */
export function testKnowledge(
	sandbox: { db: Database; dataDir: string; deviceId: string },
	options: Pick<
		KnowledgeDeps,
		"meaning" | "pageWaitMs" | "timers" | "usage"
	> & {
		/** Default: nobody hears that the learnings that wait changed. */
		notifications?: KnowledgeDeps["notifications"];
		archive?: SpaceArchive;
		/** Default: its own. Give one to make a second Knowledge as a reload does. */
		folderLocks?: KnowledgeFolderLocks;
		/** The Replica's synced documents, as its Link syncs them. Default: its own over `db`. */
		synced?: SyncedDocuments;
	} = {},
) {
	const {
		archive = createSpaceArchive(sandbox.dataDir),
		synced = createSyncedDocuments({ db: sandbox.db }),
		folderLocks = createKnowledgeFolderLocks(),
		notifications = { learningsChanged: async () => {} },
		...rest
	} = options;
	const knowledge = wireKnowledge({
		db: sandbox.db,
		dataDir: sandbox.dataDir,
		documents: synced,
		archive,
		folderLocks,
		device: { id: sandbox.deviceId, name: "test" },
		notifications,
		...rest,
	});
	return {
		knowledge,
		documents: yjsKnowledgeDocuments({
			db: sandbox.db,
			documents: synced,
		}),
		synced,
		persisted: (projectId: string) =>
			synced.open(documentName("knowledge", projectId)),
		archive,
		folderLocks,
		folder: (projectId: string) =>
			fsKnowledgeFolders(sandbox.dataDir).folder(projectId),
		close: () => knowledge.close(),
	};
}
