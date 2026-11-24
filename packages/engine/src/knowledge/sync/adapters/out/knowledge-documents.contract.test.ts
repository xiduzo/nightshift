import { migratedDb } from "@nightshift/db/testing";
import { inMemoryKnowledgeDocuments } from "./in-memory-knowledge-documents";
import { knowledgeDocumentsContract } from "./knowledge-documents.contract";
import { yjsKnowledgeDocuments } from "./yjs-knowledge-documents";

/**
 * The contract of `KnowledgeDocuments`, on both adapters. The real side
 * runs on libsql in memory: `migratedDb()`.
 */

knowledgeDocumentsContract("in memory", async () => ({
	knowledgeDocuments: inMemoryKnowledgeDocuments(),
	close: async () => {},
}));

knowledgeDocumentsContract("over yjs", async () => {
	const db = await migratedDb();
	return {
		knowledgeDocuments: yjsKnowledgeDocuments({ db }),
		close: async () => {},
	};
});
