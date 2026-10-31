import type { Database } from "@nightshift/db";
import { createKnowledgeFolders } from "../knowledge/folder";
import { createKnowledgeDocuments } from "../knowledge/knowledge-document";
import { createProjectKnowledge } from "../knowledge/project-knowledge";
import { createKnowledgeSearch } from "../knowledge/search";

/**
 * A computer's knowledge for a test, assembled as the daemon does:
 * `knowledge` for a Device and the API, the folder of a project, and
 * `close` for the search index. Content stays on this computer until a
 * test connects a Host.
 */
export function testKnowledge(
	sandbox: { db: Database; dataDir: string; deviceId: string },
	options: { pageWaitMs?: number } = {},
) {
	const search = createKnowledgeSearch(sandbox.dataDir);
	const documents = createKnowledgeDocuments({ db: sandbox.db });
	const knowledge = createProjectKnowledge({
		db: sandbox.db,
		dataDir: sandbox.dataDir,
		documents,
		deviceId: sandbox.deviceId,
		search,
		...options,
	});
	return {
		knowledge,
		documents,
		folder: (projectId: string) =>
			createKnowledgeFolders(sandbox.dataDir).folder(projectId),
		close: () => search.close(),
	};
}
