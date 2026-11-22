import { now as timeNow } from "@nightshift/time";
import type { SearchStore } from "../../search-index";
import { fsKnowledgeFolders } from "../files/adapters/out/fs-knowledge-folders";
import { langchainSectionSplitter } from "./adapters/out/langchain-section-splitter";
import { langchainVectorIndexing } from "./adapters/out/langchain-vector-indexing";
import { evaluateSearch } from "./application/evaluate-search";
import { prepareVectors } from "./application/prepare-vectors";
import type { EvaluatedQuestion } from "./domain/evaluation";
import type { KnowledgeMeaning } from "./domain/meaning";
import type { SectionPage } from "./domain/sections";
import {
	createVectorStates,
	type VectorPreparationEvent,
} from "./domain/vector-states";
import { type KnowledgeSearch, type SearchDeps, wireSearch } from "./wire";

/**
 * The search as the tests of a folder on disk build it: `wireSearch` over
 * the knowledge folders of `dataDir`.
 */
export function createKnowledgeSearch(
	dataDir: string,
	options: Omit<SearchDeps, "dataDir" | "folders"> = {},
): KnowledgeSearch {
	return wireSearch({
		dataDir,
		folders: fsKnowledgeFolders(dataDir),
		...options,
	});
}

/** The evaluation of `search`, at the time `now` gives. */
export function evaluateKnowledge(
	search: Pick<KnowledgeSearch, "search" | "meaning">,
	projectId: string,
	questions: readonly EvaluatedQuestion[],
	now: () => number = timeNow,
) {
	return evaluateSearch({
		search: ({ projectId, text, ...options }) =>
			search.search(projectId, text, options),
		meaning: ({ projectId }) => search.meaning(projectId),
		now,
	})({ projectId, questions });
}

/** The sections of a file, as the search cuts them. */
export function splitSections(
	path: string,
	content: string | readonly SectionPage[],
) {
	return langchainSectionSplitter().split(path, content);
}

/**
 * The vector preparation over a search index, bound as `wireSearch` binds
 * it: `request` is `prepareVectors`, and the states move on `clock`.
 */
export function createVectorPreparation(options: {
	store: SearchStore;
	model: () => KnowledgeMeaning | null;
	meaningOn: (projectId: string) => Promise<boolean>;
	clock: () => number;
	onEvent?: (event: VectorPreparationEvent) => void;
}) {
	const { store, clock } = options;
	const states = createVectorStates(options.onEvent);
	const prepare = prepareVectors({
		index: store,
		indexing: langchainVectorIndexing(store),
		meaning: { current: options.model },
		meaningOn: options.meaningOn,
		states,
		clock,
	});
	return {
		request: (projectId: string) => prepare({ projectId }),
		sectionsChanged: (projectId: string) =>
			states.sectionsChanged(projectId, clock()),
		vectorsGone: () => states.vectorsGone(clock()),
		stateOf: states.stateOf,
	};
}
