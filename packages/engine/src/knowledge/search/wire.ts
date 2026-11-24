import { now } from "@nightshift/time";
import type { FolderSnapshot } from "../../folder-snapshot";
import { createSearchStore } from "../../search-index";
import type { KnowledgeFolders } from "../files";
import { fsFileTexts } from "./adapters/out/fs-file-texts";
import { langchainSectionSplitter } from "./adapters/out/langchain-section-splitter";
import { langchainVectorIndexing } from "./adapters/out/langchain-vector-indexing";
import { evaluateSearch } from "./application/evaluate-search";
import { findCloseNotes } from "./application/find-close-notes";
import type { MeaningModel } from "./application/ports";
import { prepareVectors } from "./application/prepare-vectors";
import {
	type IndexForMap,
	readIndexForMap,
} from "./application/read-index-for-map";
import { readMapStamp } from "./application/read-map-stamp";
import { readMeaningStatus } from "./application/read-meaning-status";
import {
	type KnowledgeRefresh,
	refreshSearchIndex,
} from "./application/refresh-search-index";
import { searchKnowledge } from "./application/search-knowledge";
import {
	type CloseNote,
	createNoteStates,
	type NoteToCompare,
} from "./domain/close-notes";
import type {
	EvaluatedQuestion,
	KnowledgeEvaluation,
} from "./domain/evaluation";
import {
	type KnowledgeMeaning,
	type KnowledgeMeaningStatus,
	leftOn,
} from "./domain/meaning";
import type { KnowledgeHit, KnowledgeSearchMode } from "./domain/ranking";
import {
	createVectorStates,
	type VectorPreparationEvent,
} from "./domain/vector-states";

/**
 * The wiring of knowledge/search: the one place that builds its real adapters
 * and binds each use case to its ports.
 *
 * The index is derived data, never synced (ADR 4, decision 7): an SQLite
 * file of its own, `<dataDir>/knowledge/.search.sqlite`, next to the
 * projects' folders (`search-index`). It is not in the Replica: nothing else
 * reads it, it must not travel with the Replica's data, and a search that
 * writes it never waits on the Replica's writers. Delete the file and the
 * next search builds it again.
 */

/** What the knowledge gives knowledge/search: the ports another part fills, and what the real adapters stand on. */
export type SearchDeps = {
	/** Where this computer keeps its data: the index is in its `knowledge/`. */
	dataDir: string;
	/** The look at a project's folder (`files`). */
	folders: Pick<KnowledgeFolders, "scan">;
	/**
	 * The embedding model for search by meaning, or a function that gives the
	 * one to use now (the model or Ollama's address can change while Night
	 * Shift runs: another model builds the vectors again). Without it, or when
	 * it gives null, search finds by words only.
	 */
	meaning?: KnowledgeMeaning | (() => KnowledgeMeaning | null);
	/**
	 * Whether a person left search by meaning on for a project (the project's
	 * setting, `sync/domain/entry.ts`). Off: the project is searched by words
	 * only, and its vectors are not prepared. Default: on.
	 */
	meaningOn?: (projectId: string) => Promise<boolean>;
	/** The vector preparation's clock. Default `now`. */
	clock?: () => number;
	/** What hears each change of a project's vector preparation. */
	onPreparation?: (event: VectorPreparationEvent) => void;
};

/** Which notes of a project's learnings are close in meaning (`findCloseNotes`). */
export type CloseNotes = {
	among(
		projectId: string,
		read: {
			notes: () => Promise<readonly NoteToCompare[]>;
			onPrepared: () => void;
		},
	): Promise<CloseNote[][] | null>;
};

/** Search over the projects' knowledge folders on this computer, bound to its ports. */
export type KnowledgeSearch = {
	/**
	 * The project's index brought up to date with its folder, then its
	 * vectors in the background (`refreshSearchIndex`). `snapshot`: the look
	 * at the folder the caller took just now.
	 */
	refresh(
		projectId: string,
		snapshot?: FolderSnapshot,
	): Promise<KnowledgeRefresh>;
	/** The files that best match `text`, best first (`searchKnowledge`). */
	search(
		projectId: string,
		text: string,
		options?: {
			limit?: number;
			mode?: KnowledgeSearchMode;
			folders?: readonly string[];
		},
	): Promise<KnowledgeHit[]>;
	closeNotes: CloseNotes;
	/** A text that changes when `forMap` would give something else (`readMapStamp`). */
	mapStamp(projectId: string): Promise<string>;
	/** What the index holds for the Map (`readIndexForMap`). */
	forMap(
		projectId: string,
		limits: { maxBytes: number; maxBytesPerFile: number; maxVectors: number },
	): Promise<IndexForMap>;
	/** Whether search by meaning works for the project (`readMeaningStatus`). */
	meaning(projectId: string): Promise<KnowledgeMeaningStatus>;
	/** The question set against each way to search (`evaluateSearch`). */
	evaluate(
		projectId: string,
		questions: readonly EvaluatedQuestion[],
	): Promise<KnowledgeEvaluation>;
	/**
	 * Closes the index file and ends the preparations for good. A later
	 * search opens the file again, for a session that outlives this
	 * index, and prepares nothing.
	 */
	close(): void;
};

export function wireSearch(deps: SearchDeps): KnowledgeSearch {
	const given = deps.meaning;
	const clock = deps.clock ?? now;
	const meaningOn = leftOn(deps.meaningOn);
	const states = createVectorStates(deps.onPreparation);
	const notes = createNoteStates();
	const index = createSearchStore(deps.dataDir, {
		onVectorsGone: () => {
			states.vectorsGone(clock());
			notes.vectorsGone();
		},
	});
	/** The embedding model now. Null: search by meaning is off. */
	const meaning: MeaningModel = {
		current: () => (typeof given === "function" ? given() : (given ?? null)),
	};
	/** Closed for good: a later search still answers, and nothing prepares. */
	let closed = false;
	const preparing: MeaningModel = {
		current: () => (closed ? null : meaning.current()),
	};
	const prepare = prepareVectors({
		index,
		indexing: langchainVectorIndexing(index),
		meaning: preparing,
		meaningOn,
		states,
		clock,
	});
	const refresh = refreshSearchIndex({
		folders: deps.folders,
		texts: fsFileTexts(),
		splitter: langchainSectionSplitter(),
		index,
		refreshing: new Map(),
		states,
		prepare,
		clock,
	});
	const search = searchKnowledge({
		index,
		meaning,
		meaningOn,
		refresh,
		states,
		queries: { failed: false },
	});
	const status = readMeaningStatus({
		index,
		meaning,
		meaningOn,
		refresh,
		states,
		prepare,
	});
	const reads = { index, meaning, meaningOn, refresh };
	const mapStamp = readMapStamp(reads);
	const forMap = readIndexForMap(reads);
	const among = findCloseNotes({
		index,
		meaning: preparing,
		meaningOn,
		notes,
		clock,
	});
	const evaluate = evaluateSearch({
		search,
		meaning: status,
		now,
	});
	return {
		refresh: (projectId, snapshot) =>
			refresh({ projectId, ...(snapshot ? { snapshot } : {}) }),
		search: (projectId, text, options = {}) =>
			search({ projectId, text, ...options }),
		closeNotes: {
			among: (projectId, read) => among({ projectId, ...read }),
		},
		mapStamp: (projectId) => mapStamp({ projectId }),
		forMap: (projectId, limits) => forMap({ projectId, limits }),
		meaning: (projectId) => status({ projectId }),
		evaluate: (projectId, questions) => evaluate({ projectId, questions }),
		close() {
			closed = true;
			index.close();
		},
	};
}
