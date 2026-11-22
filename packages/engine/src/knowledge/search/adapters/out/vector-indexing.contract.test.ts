import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSearchStore } from "../../../../search-index";
import { SynonymEmbeddings } from "../../../../testing/embeddings";
import { inMemoryVectorIndexing } from "./in-memory-vector-indexing";
import { langchainVectorIndexing } from "./langchain-vector-indexing";
import { vectorIndexingContract } from "./vector-indexing.contract";

/** The contract of `VectorIndexing`, on both adapters. The real side runs on a new search index. */

vectorIndexingContract("in memory", async () => {
	const indexing = inMemoryVectorIndexing();
	return {
		vectorIndexing: indexing,
		model: { model: "fake-model", embeddings: new SynonymEmbeddings() },
		count: indexing.count,
		close: async () => {},
	};
});

vectorIndexingContract("over langchain", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "nightshift-indexing-"));
	const store = createSearchStore(dataDir);
	await store.open();
	const model = { model: "fake-model", embeddings: new SynonymEmbeddings() };
	return {
		vectorIndexing: langchainVectorIndexing(store),
		model,
		count: (projectId) => store.vectorsFor(projectId, model).count(),
		close: async () => {
			store.close();
			await rm(dataDir, { recursive: true, force: true });
		},
	};
});
