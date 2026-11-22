import { Document } from "@langchain/core/documents";
import { index } from "@langchain/core/indexing";
import type { SearchStore } from "../../../../search-index";
import type { VectorIndexing } from "../../application/ports";
import { embedText } from "../../domain/sections";

/** Sections embedded in one call to the model. */
const EMBED_BATCH = 32;

/**
 * `VectorIndexing` through LangChain's `index()`, on the search index's own
 * record manager and vector store (`search-index`). Every section goes in,
 * with `cleanup: "full"`: a removed file is not seen, and only `full`
 * removes what was not seen. `wireSearch` builds it.
 */
export function langchainVectorIndexing(
	store: Pick<SearchStore, "vectorsFor" | "recordsOf">,
): VectorIndexing {
	return {
		async index(projectId, model, sections) {
			await index({
				docsSource: sections.map(
					(section) =>
						new Document({
							pageContent: embedText(
								section.title,
								section.heading_path,
								section.text,
							),
							// `index()` hashes this: only what does not move when a section moves.
							metadata: { path: section.path, section_id: section.section_id },
						}),
				),
				recordManager: store.recordsOf(projectId),
				vectorStore: store.vectorsFor(projectId, model),
				options: {
					cleanup: "full",
					sourceIdKey: "path",
					batchSize: EMBED_BATCH,
				},
			});
		},
	};
}
