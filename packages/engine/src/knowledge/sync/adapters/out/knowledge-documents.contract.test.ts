import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { inMemoryKnowledgeDocuments } from "./in-memory-knowledge-documents";
import { knowledgeDocumentsContract } from "./knowledge-documents.contract";
import { yjsKnowledgeDocuments } from "./yjs-knowledge-documents";

/**
 * The contract of `KnowledgeDocuments`, on both adapters. The real side
 * runs on libsql in memory: `createDb({ DATABASE_URL: ":memory:" })` with
 * `migrateDb`.
 */

knowledgeDocumentsContract("in memory", async () => ({
	knowledgeDocuments: inMemoryKnowledgeDocuments(),
	close: async () => {},
}));

knowledgeDocumentsContract("over yjs", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	return {
		knowledgeDocuments: yjsKnowledgeDocuments({ db }),
		close: async () => {},
	};
});
