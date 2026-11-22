import { now as timeNow } from "@nightshift/time";
import { fsNotTopicsFile } from "./adapters/out/fs-not-topics-file";
import { drawMap } from "./application/draw-map";
import { markNotTopic } from "./application/mark-not-topic";
import type {
	AskedQuestions,
	FolderHolds,
	MapEntries,
	MapIndex,
	MapLearnings,
} from "./application/ports";
import type { KnowledgeMap } from "./domain/map";
import { createMapMemo } from "./domain/memo";

/**
 * The wiring of knowledge/map: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the knowledge gives knowledge/map: the ports another part fills, and what the real adapter stands on. */
export type MapDeps = {
	/** The knowledge folders on this computer (`files`). */
	folders: {
		folder(projectId: string): string;
		ensure(projectId: string): Promise<string>;
	};
	entries: MapEntries;
	index: MapIndex;
	learnings: MapLearnings;
	asked: AskedQuestions;
	holds: FolderHolds;
	/** The clock. Default `now`. */
	now?: () => number;
};

/** The Map of the projects on this computer, bound to its ports. */
export type KnowledgeMaps = {
	/** The Map of a project's knowledge (`drawMap`). */
	map(projectId: string): Promise<KnowledgeMap>;
	/** Marks a word as not a topic, or puts it back (`markNotTopic`). Returns the list. */
	markNotTopic(
		projectId: string,
		mark: { word: string; notTopic: boolean; by: string | null },
	): Promise<string[]>;
};

export function wireMap(deps: MapDeps): KnowledgeMaps {
	const notTopics = fsNotTopicsFile(deps.folders);
	const draw = drawMap({
		entries: deps.entries,
		index: deps.index,
		asked: deps.asked,
		learnings: deps.learnings,
		notTopics,
		memo: createMapMemo(),
	});
	const mark = markNotTopic({
		notTopics,
		holds: deps.holds,
		now: deps.now ?? timeNow,
	});
	return {
		map: (projectId) => draw({ projectId }),
		markNotTopic: (projectId, { word, notTopic, by }) =>
			mark({ projectId, word, notTopic, by }),
	};
}
