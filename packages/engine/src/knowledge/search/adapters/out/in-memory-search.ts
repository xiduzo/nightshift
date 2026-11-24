import { inMemoryKnowledgeFolders } from "../../../files/adapters/out/in-memory-knowledge-folders";
import { inMemorySync } from "../../../sync/adapters/out/in-memory-sync";
import { findCloseNotes } from "../../application/find-close-notes";
import { prepareVectors } from "../../application/prepare-vectors";
import { readIndexForMap } from "../../application/read-index-for-map";
import { readMapStamp } from "../../application/read-map-stamp";
import { refreshSearchIndex } from "../../application/refresh-search-index";
import { searchKnowledge } from "../../application/search-knowledge";
import { createNoteStates } from "../../domain/close-notes";
import { createVectorStates } from "../../domain/vector-states";
import type { KnowledgeSearch } from "../../wire";
import { inMemorySearchPorts } from "./in-memory-neighbours";

/**
 * The search over in-memory adapters: the real use cases, with the files a
 * test puts in (`put`). The use-case test of every slice that searches
 * takes this one. Test code: production code never imports this file.
 */
export function inMemorySearch(
	sync = inMemorySync(),
	folders = inMemoryKnowledgeFolders(),
) {
	const ports = { ...inMemorySearchPorts(), folders };
	const { index, meaning } = ports;
	const clock = sync.now;
	const states = createVectorStates();
	const meaningOn = async (projectId: string) =>
		(await sync.documents.open(projectId)).meaningOn();
	const refresh = refreshSearchIndex({
		folders,
		texts: ports.fileTexts,
		splitter: ports.sectionSplitter,
		index,
		refreshing: new Map(),
		states,
		prepare: prepareVectors({
			index,
			indexing: ports.vectorIndexing,
			meaning,
			meaningOn,
			states,
			clock,
		}),
		clock,
	});
	const reads = { index, meaning, meaningOn, refresh };
	const search = searchKnowledge({
		...reads,
		states,
		queries: { failed: false },
	});
	const stamp = readMapStamp(reads);
	const forMap = readIndexForMap(reads);
	const among = findCloseNotes({
		index,
		meaning,
		meaningOn,
		notes: createNoteStates(),
		clock,
	});
	const bound = {
		refresh: (projectId, snapshot) =>
			refresh({ projectId, ...(snapshot ? { snapshot } : {}) }),
		search: (projectId, text, options = {}) =>
			search({ projectId, text, ...options }),
		closeNotes: { among: (projectId, read) => among({ projectId, ...read }) },
		mapStamp: (projectId) => stamp({ projectId }),
		forMap: (projectId, limits) => forMap({ projectId, limits }),
	} satisfies Partial<KnowledgeSearch>;
	return {
		...ports,
		...bound,
		/** Puts a text file in the project's folder, where a refresh finds it. */
		put(projectId: string, path: string, text: string, changedAt = 1) {
			folders.put(projectId, path, text, changedAt);
			ports.fileTexts.put(folders.folder(projectId), path, text);
		},
	};
}
