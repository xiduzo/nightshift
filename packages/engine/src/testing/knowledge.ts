import type { Database } from "@nightshift/db";
import { createSpaceArchive, type SpaceArchive } from "../archive";
import type { SyncedDocuments } from "../documents";
import { createKnowledgeFolders } from "../knowledge/folder";
import { createKnowledgeDocuments } from "../knowledge/knowledge-document";
import type { KnowledgeMeaning } from "../knowledge/meaning";
import { createProjectKnowledge } from "../knowledge/project-knowledge";
import { createKnowledgeSearch } from "../knowledge/search";

/**
 * A computer's knowledge for a test, assembled as the daemon does:
 * `knowledge` for a Device and the API, the folder of a project, its Space
 * archive (`archive`, a new one unless the test gives the one of its peer
 * engine), and `close` for the search index. Content stays on this
 * computer until the archive is connected to the Hosts.
 */
export function testKnowledge(
	sandbox: { db: Database; dataDir: string; deviceId: string },
	options: {
		pageWaitMs?: number;
		archive?: SpaceArchive;
		/** The Replica's synced documents, as its Link syncs them. Default: its own over `db`. */
		synced?: SyncedDocuments;
		/** Search by meaning with this model. Default: by words only. */
		meaning?: KnowledgeMeaning;
	} = {},
) {
	const {
		archive = createSpaceArchive(sandbox.dataDir),
		synced,
		meaning,
		...rest
	} = options;
	const documents = createKnowledgeDocuments({
		db: sandbox.db,
		...(synced ? { documents: synced } : {}),
	});
	const search = createKnowledgeSearch(sandbox.dataDir, {
		...(meaning ? { meaning } : {}),
		meaningOn: (projectId) => knowledge.meaningOn(projectId),
	});
	const knowledge = createProjectKnowledge({
		db: sandbox.db,
		dataDir: sandbox.dataDir,
		documents,
		deviceId: sandbox.deviceId,
		search,
		archive,
		...rest,
	});
	return {
		knowledge,
		documents,
		archive,
		search,
		folder: (projectId: string) =>
			createKnowledgeFolders(sandbox.dataDir).folder(projectId),
		close: () => search.close(),
	};
}
